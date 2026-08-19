/**
 * Cloudflare Quick Tunnel for the **mobile data plane only**.
 *
 * This module manages a `cloudflared tunnel --url http://127.0.0.1:<port>`
 * child process so a phone on 4G (no Tailscale, not on the LAN) can reach the
 * `/m` pairing page and `/m/ws` E2EE WebSocket over a public `trycloudflare.com`
 * HTTPS URL. Default reachability stays LAN; the public tunnel is started only
 * from the settings page (explicit opt-in).
 *
 * The tunnel is named Quick — the URL is random, expiring, and treated as a
 * temporary capability. It is a "key" that lets anyone who holds it reach `/m`.
 * Pairing is still gated by the E2EE handshake (fragment secret + shared key);
 * a bare URL holder cannot complete `e2ee_auth`.
 *
 * Hard rules (mirror the threat model):
 *  - Only ever funnel `127.0.0.1:<dataPlanePort>` (default 6879).
 *  - Never funnel `3080` / `dsh web`.
 *  - Stop the child on plugin unload / explicit stop.
 *  - `cloudflared` is resolved, never downloaded or installed.
 */

import { spawn as nodeSpawn } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { readJsonFile, writeFileAtomic } from "./storage.js";

/** Extract the public Quick Tunnel URL from cloudflared banner output. */
export function parseQuickTunnelUrl(text: string): string | null {
	const match = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(text);
	return match === null ? null : match[0];
}

/** True once the edge has accepted this connector (URL alone is not enough). */
export function isTunnelRegistered(text: string): boolean {
	return /registered tunnel connection/i.test(text);
}

const HINT_PATH = join(homedir(), ".local", "bin", "cloudflared");

function pathBinaryExists(name: string): boolean {
	for (const dir of (process.env.PATH ?? "").split(":")) {
		if (dir === "") continue;
		try {
			if (existsSync(join(dir, name))) return true;
		} catch {
			// ignore unreadable PATH entries
		}
	}
	return false;
}

/**
 * Resolve the `cloudflared` binary to run. Priority:
 *   1. `CLOUDFLARED` env var
 *   2. `~/.local/bin/cloudflared`
 *   3. `cloudflared` on `PATH`
 * Returns `null` when nothing is found. Never downloads or installs.
 */
export function resolveCloudflaredBinary(): string | null {
	const env = process.env.CLOUDFLARED;
	if (typeof env === "string" && env.trim().length > 0) return env;
	if (existsSync(HINT_PATH)) return HINT_PATH;
	if (pathBinaryExists("cloudflared")) return "cloudflared";
	return null;
}

export interface CloudflareQuickTunnelSnapshot {
	readonly running: boolean;
	readonly kind: "cloudflare-quick" | null;
	readonly url: string | null;
	readonly binaryOk: boolean;
}

/** Minimal child-process face (subset of `ChildProcess`) used for typing + tests. */
export interface ChildLike {
	readonly stderr: NodeJS.ReadableStream | null;
	readonly stdout: NodeJS.ReadableStream | null;
	readonly pid?: number;
	kill(signal?: NodeJS.Signals | number): boolean;
	on(event: string, listener: (...args: unknown[]) => void): unknown;
}

export type SpawnFn = (
	command: string,
	args: readonly string[],
	options?: Record<string, unknown>,
) => ChildLike;

function isPidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

/**
 * Owns one `cloudflared tunnel` child process. Injectable `binary` / `spawn`
 * keep it unit-testable without ever launching a real tunnel.
 */
export class CloudflareQuickTunnel {
	private readonly binary: string | null;
	private readonly spawnImpl: SpawnFn;
	private readonly persistFile: string | null;
	private child: ChildLike | null = null;
	private url: string | null = null;

	constructor(
		options: {
			/** Binary/command to run. Defaults to `resolveCloudflaredBinary()`. */
			binary?: string | null;
			/** Spawn implementation. Defaults to `node:child_process.spawn`. */
			spawn?: SpawnFn;
			/** When set, persisted tunnel state is written here (storage helpers). */
			persistFile?: string | null;
		} = {},
	) {
		this.binary = options.binary === undefined ? resolveCloudflaredBinary() : options.binary;
		this.spawnImpl = options.spawn ?? ((command, args) => nodeSpawn(command, args) as unknown as ChildLike);
		this.persistFile = options.persistFile ?? null;
		if (this.persistFile !== null) this.#clearStalePersisted();
	}

	get binaryOk(): boolean {
		return this.binary !== null;
	}

	snapshot(): CloudflareQuickTunnelSnapshot {
		const running = this.child !== null;
		return {
			running,
			kind: running ? "cloudflare-quick" : null,
			url: running ? this.url : null,
			binaryOk: this.binaryOk,
		};
	}

	/** Start the tunnel and resolve with the public URL when it appears. */
	async start(options: { port: number; timeoutMs?: number }): Promise<string> {
		if (this.binary === null) {
			throw new Error(
				"cloudflared binary not found; install it to ~/.local/bin/cloudflared",
			);
		}
		if (this.child !== null) {
			if (this.url !== null) return this.url;
			throw new Error("tunnel is already starting");
		}
		const timeoutMs = options.timeoutMs ?? 45_000;
		// QUIC/UDP 7844 fails through this host's Tailscale exit node; HTTP/2 works.
		const args = [
			"tunnel",
			"--url",
			`http://127.0.0.1:${String(options.port)}`,
			"--no-autoupdate",
			"--protocol",
			"http2",
		];
		if (this.persistFile !== null) {
			args.push("--logfile", join(dirname(this.persistFile), "cloudflared.log"));
		}
		const child = this.spawnImpl(this.binary, args);
		this.child = child;
		this.url = null;
		this.#persist();

		return await new Promise<string>((resolvePromise, rejectPromise) => {
			let settled = false;
			let buffer = "";
			const fail = (message: string): void => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				this.child = null;
				this.url = null;
				this.#removePersisted();
				rejectPromise(new Error(message));
			};
			const onChunk = (chunk: string | Buffer): void => {
				buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
				if (settled) return;
				const parsed = parseQuickTunnelUrl(buffer);
				if (parsed !== null) this.url = parsed;
				if (this.url !== null && isTunnelRegistered(buffer)) {
					settled = true;
					clearTimeout(timer);
					this.#persist();
					resolvePromise(this.url);
				}
			};
			const onExit = (_code: unknown, _signal: unknown): void => {
				if (!settled) {
					fail(`cloudflared exited before publishing a tunnel URL`);
					return;
				}
				// Unexpected exit after success: clear owned state so snapshot is accurate.
				this.child = null;
				this.url = null;
				this.#removePersisted();
			};
			const timer = setTimeout(() => {
				if (settled) return;
				try {
					child.kill("SIGTERM");
				} catch {
					// child already gone
				}
				fail(
					this.url === null
						? "timed out waiting for the Cloudflare Quick Tunnel URL"
						: "timed out waiting for the tunnel to register with Cloudflare (HTTP/2). Tailscale exit node can break QUIC; retry after the plugin uses --protocol http2",
				);
			}, timeoutMs);
			if (child.stderr !== null) child.stderr.on("data", onChunk);
			if (child.stdout !== null) child.stdout.on("data", onChunk);
			child.on("exit", onExit);
		});
	}

	/** SIGTERM the child (if any) and clear state/persistence. */
	async stop(): Promise<void> {
		const child = this.child;
		this.child = null;
		this.url = null;
		this.#removePersisted();
		if (child === null) return;
		try {
			child.kill("SIGTERM");
		} catch {
			// already gone
		}
		await new Promise<void>((resolvePromise) => {
			let done = false;
			const finish = (): void => {
				if (done) return;
				done = true;
				resolvePromise();
			};
			child.on("exit", finish);
			setTimeout(finish, 500);
		});
	}

	/** If a fresh instance finds a persisted tunnel whose child pid is dead, clear it. */
	#clearStalePersisted(): void {
		if (this.persistFile === null) return;
		const persisted = readJsonFile<{ pid?: unknown }>(this.persistFile);
		if (persisted === null) return;
		if (typeof persisted.pid !== "number" || !isPidAlive(persisted.pid)) {
			this.#removePersisted();
		}
	}

	#persist(): void {
		if (this.persistFile === null) return;
		if (this.child === null) return;
		writeFileAtomic(
			this.persistFile,
			JSON.stringify({
				kind: "cloudflare-quick",
				url: this.url,
				pid: this.child.pid,
				startedAt: Date.now(),
			}),
		);
	}

	#removePersisted(): void {
		if (this.persistFile === null) return;
		try {
			unlinkSync(this.persistFile);
		} catch {
			// already absent
		}
	}
}
