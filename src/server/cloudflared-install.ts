/**
 * Opt-in download of the official cloudflared binary into ~/.local/bin.
 * Never called from apply() / import. GitHub releases only; pinned sha256 required.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	accessSync,
	constants as fsConstants,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

/** Pinned official release (bump deliberately in PRs; not `latest`). */
export const CLOUDFLARED_RELEASE = "2026.8.2" as const;

export type CloudflaredAsset =
	| "cloudflared-linux-amd64"
	| "cloudflared-linux-arm64"
	| "cloudflared-darwin-amd64.tgz"
	| "cloudflared-darwin-arm64.tgz"
	| "cloudflared-windows-amd64.exe"
	| "cloudflared-windows-386.exe";

/** @deprecated Use CloudflaredAsset. Kept for call-site compatibility. */
export type CloudflaredLinuxAsset = CloudflaredAsset;

export interface CloudflaredPin {
	/** SHA256 of the GitHub release asset bytes (archive or raw binary). */
	readonly downloadSha256: string;
	/** SHA256 of the installed executable after extraction (same as download for raw assets). */
	readonly binarySha256: string;
}

/**
 * Source of truth for trusted downloads + installed binaries.
 * SHA256SUMS from the tag is defense in depth only (and often absent for non-Linux assets).
 */
export const CLOUDFLARED_PINS: Readonly<Record<CloudflaredAsset, CloudflaredPin>> = {
	"cloudflared-linux-amd64": {
		downloadSha256: "fcfb02b575a52ca1af2e3267af4e1517bcdeb30ac48c834c69abaed3c0576ad2",
		binarySha256: "fcfb02b575a52ca1af2e3267af4e1517bcdeb30ac48c834c69abaed3c0576ad2",
	},
	"cloudflared-linux-arm64": {
		downloadSha256: "7747d94570fb390cf47dcb4f9555c193c6355cda9793f0d878d9049e5d6a7790",
		binarySha256: "7747d94570fb390cf47dcb4f9555c193c6355cda9793f0d878d9049e5d6a7790",
	},
	"cloudflared-darwin-amd64.tgz": {
		downloadSha256: "f1727723c586500e2092368ae21871b3df7ddfd2cb097f22d81bee4a9c458bb4",
		binarySha256: "b0f770e1e0b281399a57219b840fd8eef1cc25387a404124248157ea2073727a",
	},
	"cloudflared-darwin-arm64.tgz": {
		downloadSha256: "9042c2c5d8b2de78e60f313d5fb31b6c5c1cebde787a3caf1f2c9588084ac442",
		binarySha256: "b61054d3d6326ea558cb49826eebf5676e0d0a36d51b546975096ca3e0e3c89d",
	},
	"cloudflared-windows-amd64.exe": {
		downloadSha256: "c29eee2b121f5436a642eed69fd9767da7e7b8c510fa50aaa130337f931357b5",
		binarySha256: "c29eee2b121f5436a642eed69fd9767da7e7b8c510fa50aaa130337f931357b5",
	},
	"cloudflared-windows-386.exe": {
		downloadSha256: "6acb072357618fa16c53c43e05438ed728aacd47119f1c6c3aa1a668c3299b43",
		binarySha256: "6acb072357618fa16c53c43e05438ed728aacd47119f1c6c3aa1a668c3299b43",
	},
};

/** Installed-binary pin map (verify path). */
export const CLOUDFLARED_SHA256: Readonly<Record<CloudflaredAsset, string>> = Object.freeze(
	Object.fromEntries(
		(Object.keys(CLOUDFLARED_PINS) as CloudflaredAsset[]).map((asset) => [
			asset,
			CLOUDFLARED_PINS[asset].binarySha256,
		]),
	) as Record<CloudflaredAsset, string>,
);

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

export function cloudflaredAssetFor(platform: string, arch: string): CloudflaredAsset | null {
	if (platform === "linux" && (arch === "x64" || arch === "x86_64")) return "cloudflared-linux-amd64";
	if (platform === "linux" && arch === "arm64") return "cloudflared-linux-arm64";
	if (platform === "darwin" && (arch === "x64" || arch === "x86_64")) return "cloudflared-darwin-amd64.tgz";
	if (platform === "darwin" && arch === "arm64") return "cloudflared-darwin-arm64.tgz";
	if (platform === "win32" && (arch === "x64" || arch === "x86_64")) return "cloudflared-windows-amd64.exe";
	if (platform === "win32" && (arch === "ia32" || arch === "x86" || arch === "386")) {
		return "cloudflared-windows-386.exe";
	}
	return null;
}

export function installedBinaryName(platform: string = process.platform): string {
	return platform === "win32" ? "cloudflared.exe" : "cloudflared";
}

export function expectedSha256For(platform: string = process.platform, arch: string = process.arch): string | null {
	const asset = cloudflaredAssetFor(platform, arch);
	return asset === null ? null : CLOUDFLARED_PINS[asset].binarySha256;
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
	const pathSep = process.platform === "win32" ? ";" : ":";
	for (const dir of (process.env.PATH ?? "").split(pathSep)) {
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
		/** Test override; defaults to the installed-binary pin for this platform asset. */
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
	const expected = options?.expectedSha256 ?? CLOUDFLARED_PINS[asset].binarySha256;
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

function isTarGzAsset(asset: CloudflaredAsset): boolean {
	return asset.endsWith(".tgz");
}

/** Extract the `cloudflared` member from an official darwin .tgz using system tar. */
export function extractCloudflaredFromTarGz(
	archiveBytes: Buffer,
	options?: {
		extractImpl?: (archivePath: string, destDir: string) => void;
	},
): Buffer {
	const work = mkdtempSync(join(tmpdir(), "dshmr-cf-tgz-"));
	const archivePath = join(work, "cloudflared.tgz");
	const extractDir = join(work, "out");
	try {
		writeFileSync(archivePath, archiveBytes);
		mkdirSync(extractDir, { recursive: true });
		const extract =
			options?.extractImpl ??
			((archive, dest) => {
				const result = spawnSync("tar", ["-xzf", archive, "-C", dest], { encoding: "utf8" });
				if (result.status !== 0) {
					throw new Error(`tar extract failed: ${result.stderr || result.stdout || String(result.status)}`);
				}
			});
		extract(archivePath, extractDir);
		const binaryPath = join(extractDir, "cloudflared");
		if (!existsSync(binaryPath)) {
			throw new Error("cloudflared member missing from darwin archive");
		}
		return readFileSync(binaryPath);
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
}

export async function installOfficialCloudflared(options?: {
	platform?: string;
	arch?: string;
	destDir?: string;
	fetchImpl?: typeof fetch;
	/**
	 * Test override for the **download asset** checksum (not the post-extract binary).
	 * Defaults to CLOUDFLARED_PINS[asset].downloadSha256.
	 */
	pinnedSha256?: string;
	/** Test override for post-extract binary verification. */
	pinnedBinarySha256?: string;
	/** Test override for tar extraction. */
	extractTarGzImpl?: (archivePath: string, destDir: string) => void;
}): Promise<InstallResult> {
	const platform = options?.platform ?? process.platform;
	const arch = options?.arch ?? process.arch;
	const asset = cloudflaredAssetFor(platform, arch);
	if (asset === null) {
		throw new Error(`no official cloudflared binary for ${platform}/${arch}; install it yourself`);
	}
	const pin = CLOUDFLARED_PINS[asset];
	const destDir = options?.destDir ?? join(homedir(), ".local", "bin");
	const fetchImpl = options?.fetchImpl ?? fetch;
	const sumsUrl = `${CLOUDFLARED_DOWNLOAD_PREFIX}SHA256SUMS`;
	const binUrl = `${CLOUDFLARED_DOWNLOAD_PREFIX}${asset}`;
	assertGithubDownloadUrl(sumsUrl);
	assertGithubDownloadUrl(binUrl);
	const pinnedDownload = options?.pinnedSha256 ?? pin.downloadSha256;
	const pinnedBinary = options?.pinnedBinarySha256 ?? options?.pinnedSha256 ?? pin.binarySha256;
	// Pin map is SoT; SUMS from the tag is optional defense in depth.
	try {
		const sumsText = await readText(fetchImpl, sumsUrl);
		const fromSums = parseSha256Sums(sumsText, asset);
		if (fromSums !== null && fromSums !== pinnedDownload) {
			throw new Error("SHA256SUMS disagrees with pinned cloudflared sha256 map");
		}
	} catch (error) {
		if (error instanceof Error && /disagrees with pinned/.test(error.message)) throw error;
		// Missing or unreadable SUMS is fine — pin map still gates the bytes.
	}
	const downloaded = await readBytes(fetchImpl, binUrl);
	const actualDownload = createHash("sha256").update(downloaded).digest("hex");
	if (actualDownload !== pinnedDownload) throw new Error("cloudflared checksum mismatch");

	const binaryBytes = isTarGzAsset(asset)
		? extractCloudflaredFromTarGz(downloaded, { extractImpl: options?.extractTarGzImpl })
		: downloaded;

	await mkdir(destDir, { recursive: true });
	const dest = join(destDir, installedBinaryName(platform));
	const tmp = `${dest}.tmp`;
	await writeFile(tmp, binaryBytes);
	if (platform !== "win32") {
		await chmod(tmp, 0o755);
	}
	await rename(tmp, dest);
	const verified = verifyCloudflaredBinary(dest, {
		platform,
		arch,
		expectedSha256: pinnedBinary,
	});
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
