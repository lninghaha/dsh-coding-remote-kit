/**
 * Opt-in download of the official cloudflared binary into ~/.local/bin.
 * Never called from apply() / import. GitHub releases only; pinned sha256 required.
 */

import { createHash } from "node:crypto";
import { accessSync, constants as fsConstants, existsSync, readFileSync } from "node:fs";
import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** Pinned official release (bump deliberately in PRs; not `latest`). */
export const CLOUDFLARED_RELEASE = "2026.8.2" as const;

export type CloudflaredLinuxAsset = "cloudflared-linux-amd64" | "cloudflared-linux-arm64";

/** Source of truth for trusted binaries. SHA256SUMS from the tag is defense in depth only. */
export const CLOUDFLARED_SHA256: Readonly<Record<CloudflaredLinuxAsset, string>> = {
	"cloudflared-linux-amd64": "fcfb02b575a52ca1af2e3267af4e1517bcdeb30ac48c834c69abaed3c0576ad2",
	"cloudflared-linux-arm64": "7747d94570fb390cf47dcb4f9555c193c6355cda9793f0d878d9049e5d6a7790",
};

export const CLOUDFLARED_DOWNLOAD_PREFIX =
	`https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_RELEASE}/`;

const MAX_BYTES = 80 * 1024 * 1024;
const FETCH_MS = 60_000;

export type CloudflaredVerifyStatus =
	| "ok"
	| "missing"
	| "not-pinned"
	| "unsupported-platform"
	| "hash-mismatch"
	| "unreadable";

export interface CloudflaredVerifyOk {
	readonly ok: true;
	readonly path: string;
	readonly sha256: string;
	readonly release: string;
	readonly status: "ok";
}

export interface CloudflaredVerifyFail {
	readonly ok: false;
	readonly status: Exclude<CloudflaredVerifyStatus, "ok">;
	readonly path: string | null;
	readonly message: string;
}

export type CloudflaredVerifyResult = CloudflaredVerifyOk | CloudflaredVerifyFail;

/** Bare command names (no dir separator) cannot be trusted without an absolute pin-checked path. */
export function isBareCommandName(value: string): boolean {
	const trimmed = value.trim();
	return trimmed.length > 0 && !trimmed.includes("/") && !trimmed.includes("\\");
}

/** Replace `$HOME` prefix with `~` so support dumps stay useful without leaking layout. */
export function redactHomePath(path: string | null, home: string = homedir()): string | null {
	if (path === null || path === "") return null;
	if (home !== "" && (path === home || path.startsWith(`${home}/`) || path.startsWith(`${home}\\`))) {
		return `~${path.slice(home.length)}`;
	}
	return path;
}

export function cloudflaredAssetFor(platform: string, arch: string): CloudflaredLinuxAsset | null {
	if (platform === "linux" && (arch === "x64" || arch === "x86_64")) return "cloudflared-linux-amd64";
	if (platform === "linux" && arch === "arm64") return "cloudflared-linux-arm64";
	return null;
}

export function expectedSha256For(platform: string = process.platform, arch: string = process.arch): string | null {
	const asset = cloudflaredAssetFor(platform, arch);
	return asset === null ? null : CLOUDFLARED_SHA256[asset];
}

export function expectedSha256Prefix(platform: string = process.platform, arch: string = process.arch): string | null {
	const expected = expectedSha256For(platform, arch);
	return expected === null ? null : expected.slice(0, 8);
}

export function parseSha256Sums(text: string, filename: string): string | null {
	for (const raw of text.split("\n")) {
		const line = raw.trim();
		const match = /^([a-fA-F0-9]{64})\s+\*?(\S+)$/.exec(line);
		if (match === null) continue;
		const digest = match[1];
		const nameField = match[2];
		if (digest === undefined || nameField === undefined) continue;
		const name = nameField.split("/").at(-1);
		if (name === filename) return digest.toLowerCase();
	}
	return null;
}

export function assertGithubDownloadUrl(url: string): void {
	if (!url.startsWith(CLOUDFLARED_DOWNLOAD_PREFIX)) {
		throw new Error("refusing to download cloudflared from a non-GitHub official URL");
	}
}

/** Absolute path for a resolved binary name when it exists on disk / PATH. */
export function resolveExistingBinaryPath(resolved: string): string | null {
	if (resolved.includes("/") || resolved.includes("\\")) {
		return existsSync(resolved) ? resolved : null;
	}
	for (const dir of (process.env.PATH ?? "").split(":")) {
		if (dir === "") continue;
		const candidate = join(dir, resolved);
		try {
			if (existsSync(candidate)) {
				accessSync(candidate, fsConstants.R_OK);
				return candidate;
			}
		} catch {
			// skip unreadable PATH entries
		}
	}
	return null;
}

export function verifyCloudflaredBinary(
	path: string,
	options?: {
		platform?: string;
		arch?: string;
		readFileSyncImpl?: (p: string) => Buffer;
		/** Test override; defaults to the pin map for this platform asset. */
		expectedSha256?: string;
	},
): CloudflaredVerifyResult {
	if (isBareCommandName(path)) {
		return {
			ok: false,
			status: "not-pinned",
			path: null,
			message: "refusing bare PATH name; cloudflared must be an absolute pinned binary",
		};
	}
	const platform = options?.platform ?? process.platform;
	const arch = options?.arch ?? process.arch;
	const asset = cloudflaredAssetFor(platform, arch);
	if (asset === null) {
		return {
			ok: false,
			status: "unsupported-platform",
			path,
			message: `no pinned cloudflared binary for ${platform}/${arch}`,
		};
	}
	const expected = options?.expectedSha256 ?? CLOUDFLARED_SHA256[asset];
	const absolute = resolveExistingBinaryPath(path);
	if (absolute === null) {
		return { ok: false, status: "missing", path, message: "cloudflared binary not found" };
	}
	try {
		const read = options?.readFileSyncImpl ?? readFileSync;
		const bytes = read(absolute);
		const sha256 = createHash("sha256").update(bytes).digest("hex");
		if (sha256 !== expected) {
			return {
				ok: false,
				status: "hash-mismatch",
				path: absolute,
				message: "cloudflared binary does not match pinned release sha256",
			};
		}
		return { ok: true, status: "ok", path: absolute, sha256, release: CLOUDFLARED_RELEASE };
	} catch {
		return { ok: false, status: "unreadable", path: absolute, message: "cloudflared binary unreadable" };
	}
}

export interface InstallResult {
	readonly asset: string;
	readonly path: string;
	readonly release: string;
}

export async function installOfficialCloudflared(options?: {
	platform?: string;
	arch?: string;
	destDir?: string;
	fetchImpl?: typeof fetch;
	/** Test override; defaults to the pin map for this platform asset. */
	pinnedSha256?: string;
}): Promise<InstallResult> {
	const platform = options?.platform ?? process.platform;
	const arch = options?.arch ?? process.arch;
	const asset = cloudflaredAssetFor(platform, arch);
	if (asset === null) {
		throw new Error(`no official cloudflared binary for ${platform}/${arch}; install it yourself`);
	}
	const destDir = options?.destDir ?? join(homedir(), ".local", "bin");
	const fetchImpl = options?.fetchImpl ?? fetch;
	const sumsUrl = `${CLOUDFLARED_DOWNLOAD_PREFIX}SHA256SUMS`;
	const binUrl = `${CLOUDFLARED_DOWNLOAD_PREFIX}${asset}`;
	assertGithubDownloadUrl(sumsUrl);
	assertGithubDownloadUrl(binUrl);
	const pinned = options?.pinnedSha256 ?? CLOUDFLARED_SHA256[asset];
	// Pin map is SoT; SUMS from the tag is optional defense in depth.
	try {
		const sumsText = await readText(fetchImpl, sumsUrl);
		const fromSums = parseSha256Sums(sumsText, asset);
		if (fromSums !== null && fromSums !== pinned) {
			throw new Error("SHA256SUMS disagrees with pinned cloudflared sha256 map");
		}
	} catch (error) {
		if (error instanceof Error && /disagrees with pinned/.test(error.message)) throw error;
		// Missing or unreadable SUMS is fine — pin map still gates the bytes.
	}
	const bytes = await readBytes(fetchImpl, binUrl);
	const actual = createHash("sha256").update(bytes).digest("hex");
	if (actual !== pinned) throw new Error("cloudflared checksum mismatch");
	await mkdir(destDir, { recursive: true });
	const dest = join(destDir, "cloudflared");
	const tmp = `${dest}.tmp`;
	await writeFile(tmp, bytes);
	await chmod(tmp, 0o755);
	await rename(tmp, dest);
	const verified = verifyCloudflaredBinary(dest, { platform, arch, expectedSha256: pinned });
	if (!verified.ok) throw new Error(`installed cloudflared failed verify: ${verified.status}`);
	return { asset, path: dest, release: CLOUDFLARED_RELEASE };
}

async function readText(fetchImpl: typeof fetch, url: string): Promise<string> {
	const response = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_MS), redirect: "follow" });
	if (!response.ok) throw new Error(`download failed (${String(response.status)})`);
	return response.text();
}

async function readBytes(fetchImpl: typeof fetch, url: string): Promise<Buffer> {
	const response = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_MS), redirect: "follow" });
	if (!response.ok) throw new Error(`download failed (${String(response.status)})`);
	const buffer = Buffer.from(await response.arrayBuffer());
	if (buffer.byteLength > MAX_BYTES) throw new Error("download exceeded size limit");
	return buffer;
}
