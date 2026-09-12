import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

// Exercise the actual parser without adding a production export just for tests.
const result = await build({
	stdin: {
		contents: `${await readFile(new URL("../src/mobile/app.ts", import.meta.url), "utf8")}\nexport { parseQuestion, invalidPlanReview };`,
		resolveDir: fileURLToPath(new URL("../src/mobile/", import.meta.url)),
		loader: "ts",
	},
	bundle: true,
	write: false,
	format: "esm",
	platform: "browser",
});
const { parseQuestion, invalidPlanReview } = await import(
	`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
);

test("plan review retains its complete detail and declared approve label", () => {
	const detail = "## Plan\nRead the file, explain the change, then apply it.";
	const intent = { kind: "plan-review", approve: "Approve" };
	const parsed = parseQuestion("rpc", {
		sessionId: "session",
		questions: [
			{ id: "q", question: "Review plan", detail, intent, options: [{ label: "Approve" }, { label: "Reject" }] },
		],
	});
	assert.equal(parsed.questions[0].detail, detail);
	assert.deepEqual(parsed.questions[0].intent, intent);
});

test("incomplete plans cannot be answered but ordinary questions remain usable", () => {
	const plan = {
		detail: "Plan body",
		intent: { kind: "plan-review", approve: "Approve" },
		options: [{ label: "Approve" }],
	};
	assert.equal(invalidPlanReview(plan), false);
	assert.equal(invalidPlanReview({ ...plan, detail: " " }), true);
	assert.equal(invalidPlanReview({ ...plan, options: [{ label: "Reject" }] }), true);
	assert.equal(invalidPlanReview({ options: [] }), false);
});
