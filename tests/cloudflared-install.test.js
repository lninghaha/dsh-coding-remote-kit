import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import test from "node:test";
import {
	assertGithubDownloadUrl,
	cloudflaredAssetFor,
	CLOUDFLARED_DOWNLOAD_PREFIX,
	installOfficialCloudflared,
	parseSha256Sums,
} from "../lib/server/cloudflared-install.js";

test("maps linux arches and rejects unknown platforms", () => {
	assert.equal(cloudflaredAssetFor("linux", "x64"), "cloudflared-linux-amd64");
	assert.equal(cloudflaredAssetFor("linux", "arm64"), "cloudflared-linux-arm64");
	assert.equal(cloudflaredAssetFor("darwin", "arm64"), null);
	assert.equal(cloudflaredAssetFor("win32", "x64"), null);
});

test("parseSha256Sums matches the asset filename", () => {
	const text = [
		"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  cloudflared-linux-amd64",
		"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb *cloudflared-linux-arm64",
	].join("\n");
	assert.equal(parseSha256Sums(text, "cloudflared-linux-amd64"), "a".repeat(64));
	assert.equal(parseSha256Sums(text, "cloudflared-linux-arm64"), "b".repeat(64));
	assert.equal(parseSha256Sums(text, "nope"), null);
});

test("refuses non-GitHub download URLs", () => {
	assert.throws(() => assertGithubDownloadUrl("https://evil.example/cloudflared"), /non-GitHub/);
	assert.doesNotThrow(() => assertGithubDownloadUrl(`${CLOUDFLARED_DOWNLOAD_PREFIX}SHA256SUMS`));
});

test("installOfficialCloudflared writes a checksum-verified file (mock fetch)", async () => {
	const payload = Buffer.from("fake-cloudflared-bytes");
	const digest = createHash("sha256").update(payload).digest("hex");
	const destDir = mkdtempSync(join(tmpdir(), "dshmr-cf-"));
	const fetchImpl = async (url) => {
		assert.ok(String(url).startsWith(CLOUDFLARED_DOWNLOAD_PREFIX));
		if (String(url).endsWith("SHA256SUMS")) {
			return new Response(`${digest}  cloudflared-linux-amd64\n`, { status: 200 });
		}
		return new Response(payload, { status: 200 });
	};
	const result = await installOfficialCloudflared({
		platform: "linux",
		arch: "x64",
		destDir,
		fetchImpl,
	});
	assert.equal(result.asset, "cloudflared-linux-amd64");
	assert.equal(readFileSync(result.path).equals(payload), true);
});

test("installOfficialCloudflared rejects a checksum mismatch", async () => {
	const destDir = mkdtempSync(join(tmpdir(), "dshmr-cf-"));
	const fetchImpl = async (url) => {
		if (String(url).endsWith("SHA256SUMS")) {
			return new Response(`${"c".repeat(64)}  cloudflared-linux-amd64\n`, { status: 200 });
		}
		return new Response(Buffer.from("tampered"), { status: 200 });
	};
	await assert.rejects(
		installOfficialCloudflared({ platform: "linux", arch: "x64", destDir, fetchImpl }),
		/checksum mismatch/,
	);
});
