import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import test from "node:test";
import {
	assertGithubDownloadUrl,
	cloudflaredAssetFor,
	CLOUDFLARED_DOWNLOAD_PREFIX,
	CLOUDFLARED_RELEASE,
	installOfficialCloudflared,
	isBareCommandName,
	parseSha256Sums,
	redactHomePath,
	verifyCloudflaredBinary,
} from "../lib/server/cloudflared-install.js";

test("maps linux arches and rejects unknown platforms", () => {
	assert.equal(cloudflaredAssetFor("linux", "x64"), "cloudflared-linux-amd64");
	assert.equal(cloudflaredAssetFor("linux", "arm64"), "cloudflared-linux-arm64");
	assert.equal(cloudflaredAssetFor("darwin", "arm64"), null);
	assert.equal(cloudflaredAssetFor("win32", "x64"), null);
});

test("download prefix pins a release tag (not latest)", () => {
	assert.match(CLOUDFLARED_DOWNLOAD_PREFIX, /\/download\/2026\.8\.2\//);
	assert.equal(CLOUDFLARED_RELEASE, "2026.8.2");
	assert.doesNotMatch(CLOUDFLARED_DOWNLOAD_PREFIX, /\/latest\//);
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
	assert.doesNotThrow(() =>
		assertGithubDownloadUrl(`${CLOUDFLARED_DOWNLOAD_PREFIX}cloudflared-linux-amd64`),
	);
});

test("isBareCommandName and redactHomePath", () => {
	assert.equal(isBareCommandName("cloudflared"), true);
	assert.equal(isBareCommandName("/usr/bin/cloudflared"), false);
	assert.equal(redactHomePath("/home/ning/.local/bin/cloudflared", "/home/ning"), "~/.local/bin/cloudflared");
	assert.equal(redactHomePath("/opt/cloudflared", "/home/ning"), "/opt/cloudflared");
	assert.equal(redactHomePath(null), null);
});

test("verifyCloudflaredBinary rejects bare PATH names as not-pinned", () => {
	const result = verifyCloudflaredBinary("cloudflared", { platform: "linux", arch: "x64" });
	assert.equal(result.ok, false);
	assert.equal(result.status, "not-pinned");
});

test("verifyCloudflaredBinary ok / hash-mismatch with injectable expected digest", () => {
	const dir = mkdtempSync(join(tmpdir(), "dshmr-cf-verify-"));
	const path = join(dir, "cloudflared");
	const payload = Buffer.from("pinned-bytes");
	writeFileSync(path, payload);
	const digest = createHash("sha256").update(payload).digest("hex");
	const ok = verifyCloudflaredBinary(path, {
		platform: "linux",
		arch: "x64",
		expectedSha256: digest,
	});
	assert.equal(ok.ok, true);
	assert.equal(ok.status, "ok");
	const bad = verifyCloudflaredBinary(path, {
		platform: "linux",
		arch: "x64",
		expectedSha256: "0".repeat(64),
	});
	assert.equal(bad.ok, false);
	assert.equal(bad.status, "hash-mismatch");
});

test("installOfficialCloudflared writes a checksum-verified file (mock fetch + pin override)", async () => {
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
		pinnedSha256: digest,
	});
	assert.equal(result.asset, "cloudflared-linux-amd64");
	assert.equal(result.release, CLOUDFLARED_RELEASE);
	assert.equal(readFileSync(result.path).equals(payload), true);
});

test("installOfficialCloudflared rejects a checksum mismatch", async () => {
	const destDir = mkdtempSync(join(tmpdir(), "dshmr-cf-"));
	const fetchImpl = async (url) => {
		if (String(url).endsWith("SHA256SUMS")) {
			return new Response(`${"c".repeat(64)}  cloudflared-linux-amd64\n`, { status: 404 });
		}
		return new Response(Buffer.from("tampered"), { status: 200 });
	};
	await assert.rejects(
		installOfficialCloudflared({
			platform: "linux",
			arch: "x64",
			destDir,
			fetchImpl,
			pinnedSha256: "d".repeat(64),
		}),
		/checksum mismatch/,
	);
});
