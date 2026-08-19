/**
 * Opt-in download of the official cloudflared binary into ~/.local/bin.
 * Never called from apply() / import. GitHub releases only; sha256 required.
 */

import { createHash } from "node:crypto";
import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const CLOUDFLARED_DOWNLOAD_PREFIX =
	"https://github.com/cloudflare/cloudflared/releases/latest/download/";

const MAX_BYTES = 80 * 1024 * 1024;
const FETCH_MS = 60_000;

export function cloudflaredAssetFor(platform: string, arch: string): string | null {
	if (platform === "linux" && (arch === "x64" || arch === "x86_64")) return "cloudflared-linux-amd64";
	if (platform === "linux" && arch === "arm64") return "cloudflared-linux-arm64";
	return null;
}

export function parseSha256Sums(text: string, filename: string): string | null {
	for (const raw of text.split("\n")) {
		const line = raw.trim();
		const match = /^([a-fA-F0-9]{64})\s+\*?(\S+)$/.exec(line);
		if (match === null) continue;
		const name = match[2].split("/").at(-1);
		if (name === filename) return match[1].toLowerCase();
	}
	return null;
}

export function assertGithubDownloadUrl(url: string): void {
	if (!url.startsWith(CLOUDFLARED_DOWNLOAD_PREFIX)) {
		throw new Error("refusing to download cloudflared from a non-GitHub official URL");
	}
}

export interface InstallResult {
	readonly asset: string;
	readonly path: string;
}

export async function installOfficialCloudflared(options?: {
	platform?: string;
	arch?: string;
	destDir?: string;
	fetchImpl?: typeof fetch;
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
	const sumsText = await readText(fetchImpl, sumsUrl);
	const expected = parseSha256Sums(sumsText, asset);
	if (expected === null) throw new Error("SHA256SUMS did not list this asset");
	const bytes = await readBytes(fetchImpl, binUrl);
	const actual = createHash("sha256").update(bytes).digest("hex");
	if (actual !== expected) throw new Error("cloudflared checksum mismatch");
	await mkdir(destDir, { recursive: true });
	const dest = join(destDir, "cloudflared");
	const tmp = `${dest}.tmp`;
	await writeFile(tmp, bytes);
	await chmod(tmp, 0o755);
	await rename(tmp, dest);
	return { asset, path: dest };
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
