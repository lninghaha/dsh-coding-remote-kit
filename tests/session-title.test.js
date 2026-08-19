import assert from "node:assert/strict";
import test from "node:test";
import { extractSessionTitle, mapSessionItem } from "../lib/server/upstream.js";

test("extractSessionTitle accepts string and nested title/value/text", () => {
	assert.equal(extractSessionTitle({ values: { title: "了解下项目" } }), "了解下项目");
	assert.equal(extractSessionTitle({ values: { title: { text: "嵌套" } } }), "嵌套");
	assert.equal(extractSessionTitle({ values: { title: { value: "value键" } } }), "value键");
	assert.equal(extractSessionTitle({ values: { title: null } }), undefined);
	assert.equal(extractSessionTitle({ values: { title: "   " } }), undefined);
});

test("mapSessionItem keeps blank flag; list consumers hide blank rows", () => {
	const blank = mapSessionItem({
		sessionId: "s1",
		blank: true,
		running: false,
		updatedAt: 1,
		projections: { values: { title: "占位" } },
	});
	assert.equal(blank?.blank, true);
	assert.equal(blank?.title, "占位");
	const named = mapSessionItem({
		sessionId: "s2",
		blank: false,
		running: true,
		updatedAt: 2,
		cwd: "/tmp/example-project",
		projections: { values: { title: { title: "修复隧道" } } },
	});
	assert.equal(named?.title, "修复隧道");
	assert.equal(named?.cwd, "/tmp/example-project");
});
