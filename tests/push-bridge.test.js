import assert from "node:assert/strict";
import test from "node:test";
import {
	MAX_PUSH_BODY_BYTES,
	PUSH_ENDPOINT_HOST_ALLOWLIST,
	assertAllowedPushUrl,
	buildApprovalDeepLink,
	buildRedactedApprovalMessage,
	isAllowedPushHost,
	planApprovalPush,
	publicPushBridgeStatus,
	shortSessionId,
	validatePushBridgeWrite,
} from "../lib/server/push-bridge.js";

test("push host allowlist accepts ntfy/Bark public hosts only", () => {
	assert.equal(isAllowedPushHost("ntfy.sh"), true);
	assert.equal(isAllowedPushHost("my.ntfy.sh"), true);
	assert.equal(isAllowedPushHost("ntfy.envs.net"), true);
	assert.equal(isAllowedPushHost("api.day.app"), true);
	assert.equal(isAllowedPushHost("evil.example.com"), false);
	assert.equal(isAllowedPushHost("localhost"), false);
	assert.equal(isAllowedPushHost("127.0.0.1"), false);
	assert.equal(isAllowedPushHost("10.0.0.5"), false);
	assert.equal(isAllowedPushHost("192.168.1.1"), false);
	assert.equal(isAllowedPushHost("169.254.169.254"), false);
	assert.ok(PUSH_ENDPOINT_HOST_ALLOWLIST.includes("ntfy.sh"));
});

test("assertAllowedPushUrl rejects http, private IPs, and non-allowlisted hosts", () => {
	assert.equal(assertAllowedPushUrl("http://ntfy.sh/topic").ok, false);
	assert.equal(assertAllowedPushUrl("https://127.0.0.1/topic").ok, false);
	assert.equal(assertAllowedPushUrl("https://10.1.2.3/x").ok, false);
	assert.equal(assertAllowedPushUrl("https://evil.example.com/x").ok, false);
	assert.equal(assertAllowedPushUrl("https://user:pass@ntfy.sh/x").ok, false);
	const ok = assertAllowedPushUrl("https://ntfy.sh");
	assert.equal(ok.ok, true);
});

test("redacted approval message contains only event type and short session id", () => {
	const message = buildRedactedApprovalMessage("sess-ABCDEFGHsecret-payload");
	assert.equal(message.title, "DSH approval.requested");
	assert.equal(message.body, "approval.requested · sess sess-ABC");
	assert.equal(message.body.includes("secret"), false);
	assert.equal(shortSessionId("abcdefghij"), "abcdefgh");
});

test("approval deep link opens /m with focus=approval query", () => {
	const link = buildApprovalDeepLink("https://abc.trycloudflare.com/m/", "sess-1", "appr-9");
	const url = new URL(link);
	assert.equal(url.pathname.endsWith("/m/") || url.pathname.endsWith("/m"), true);
	assert.equal(url.searchParams.get("focus"), "approval");
	assert.equal(url.searchParams.get("sessionId"), "sess-1");
	assert.equal(url.searchParams.get("approvalId"), "appr-9");
});

test("validatePushBridgeWrite defaults off and requires endpoint+credential when enabled", () => {
	const previous = {
		enabled: false,
		provider: "ntfy",
		endpoint: "",
		credential: "",
	};
	const off = validatePushBridgeWrite({ enabled: false }, previous);
	assert.equal(off.ok, true);
	assert.equal(off.config.enabled, false);

	const missing = validatePushBridgeWrite(
		{ enabled: true, provider: "ntfy", endpoint: "https://ntfy.sh", credential: "" },
		previous,
	);
	assert.equal(missing.ok, false);

	const blocked = validatePushBridgeWrite(
		{ enabled: true, provider: "ntfy", endpoint: "https://evil.example.com", credential: "topic" },
		previous,
	);
	assert.equal(blocked.ok, false);
	assert.equal(blocked.reason, "host-not-allowlisted");

	const ok = validatePushBridgeWrite(
		{ enabled: true, provider: "ntfy", endpoint: "https://ntfy.sh", credential: "desk-alerts" },
		previous,
	);
	assert.equal(ok.ok, true);
	assert.equal(ok.config.enabled, true);
	assert.equal(publicPushBridgeStatus(ok.config).configured, true);
	assert.equal(publicPushBridgeStatus(ok.config).hasCredential, true);
});

test("planApprovalPush enforces body size and builds ntfy/Bark plans without secrets in message", () => {
	const base = {
		config: {
			enabled: true,
			provider: "ntfy",
			endpoint: "https://ntfy.sh",
			credential: "desk-alerts",
		},
		sessionId: "sess-ABCDEFGH",
		approvalId: "a1",
		pageUrl: "https://abc.trycloudflare.com/m/",
	};
	const ntfy = planApprovalPush(base);
	assert.equal(ntfy.ok, true);
	assert.equal(ntfy.plan.method, "POST");
	assert.ok(Buffer.byteLength(ntfy.plan.body ?? "", "utf8") <= MAX_PUSH_BODY_BYTES);
	assert.equal(ntfy.plan.body?.includes("approval.requested"), true);
	assert.equal(ntfy.plan.body?.includes("rm -rf"), false);
	assert.equal(ntfy.plan.body?.includes("toolName"), false);
	assert.equal(ntfy.plan.body?.includes("transcript"), false);

	const bark = planApprovalPush({
		...base,
		config: {
			enabled: true,
			provider: "bark",
			endpoint: "https://api.day.app",
			credential: "devicekey",
		},
	});
	assert.equal(bark.ok, true);
	assert.equal(bark.plan.method, "GET");
	assert.ok(bark.plan.url.includes("focus") && bark.plan.url.includes("approval"));
	assert.equal(bark.plan.url.includes("rm -rf"), false);
});

test("disabled or incomplete config is not considered configured", () => {
	assert.equal(
		publicPushBridgeStatus({
			enabled: false,
			provider: "ntfy",
			endpoint: "https://ntfy.sh",
			credential: "t",
		}).configured,
		false,
	);
	assert.equal(
		publicPushBridgeStatus({
			enabled: true,
			provider: "ntfy",
			endpoint: "https://ntfy.sh",
			credential: "",
		}).configured,
		false,
	);
});

test("keeping blank credential preserves previous secret when updating", () => {
	const previous = {
		enabled: true,
		provider: "ntfy",
		endpoint: "https://ntfy.sh",
		credential: "desk-alerts",
	};
	const updated = validatePushBridgeWrite(
		{ enabled: true, provider: "ntfy", endpoint: "https://ntfy.sh", credential: "" },
		previous,
	);
	assert.equal(updated.ok, true);
	assert.equal(updated.config.credential, "desk-alerts");
});
