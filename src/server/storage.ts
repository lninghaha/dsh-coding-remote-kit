/**
 * On-disk storage primitives for the mobile-remote plugin.
 *
 * Location: `$DSH_HOME/storages/mobile-remote/` where `$DSH_HOME` defaults to
 * `~/.dsh`. Directories are created 0700 and files 0600; registry writes go
 * through a temp-file + rename so a crash can never leave a half-written file.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "./crypto.js";

export function dshHome(): string {
	return process.env.DSH_HOME ?? join(homedir(), ".dsh");
}

export function storageDir(): string {
	return join(dshHome(), "storages", "mobile-remote");
}

/** Ensure the storage directory exists with mode 0700 and return its path. */
export function ensureStorageDir(): string {
	const dir = storageDir();
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	return dir;
}

/** Write a file with mode 0600 (create or truncate). */
export function writeFile600(path: string, data: string | Uint8Array): void {
	writeFileSync(path, data, { mode: 0o600 });
}

/**
 * Atomic write: write to a unique sibling temp file (0600) then rename over the
 * target. The rename is atomic on POSIX, so the target is never truncated
 * mid-write.
 */
export function writeFileAtomic(path: string, data: string | Uint8Array): void {
	const temp = `${path}.${process.pid}.${Buffer.from(randomBytes(6)).toString("hex")}.tmp`;
	writeFileSync(temp, data, { mode: 0o600 });
	try {
		renameSync(temp, path);
	} catch (error) {
		try {
			unlinkSync(temp);
		} catch {
			// best-effort cleanup; the original error is the one that matters
		}
		throw error;
	}
}

/** Read and parse a JSON file, or return null when absent. */
export function readJsonFile<T>(path: string): T | null {
	if (!existsSync(path)) return null;
	return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** Append one line to a JSONL audit file (created 0600). */
export function appendJsonLine(path: string, entry: unknown): void {
	writeFileSync(path, `${JSON.stringify(entry)}\n`, { flag: "a", mode: 0o600 });
}
