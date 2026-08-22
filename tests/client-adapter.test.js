import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function loadClientBundle() {
	let exported;
	const window = {
		__ModuleLoader__: {
			load({ factory }) {
				exported = factory(() => ({
					createElement() { return {}; },
					useEffect() {},
					useState(value) { return [typeof value === "function" ? value() : value, () => undefined]; },
				}));
			},
		},
	};
	vm.runInNewContext(readFileSync(new URL("../lib/client.js", import.meta.url), "utf8"), { window });
	return exported;
}

function slotsCounter() {
	const counts = { inject: 0, register: 0, dispose: 0 };
	return {
		counts,
		slots: {
			inject(_name, factory) {
				counts.inject += 1;
				factory();
				return () => { counts.dispose += 1; };
			},
			register() {
				counts.register += 1;
				return () => undefined;
			},
		},
	};
}

test("client adapter treats slots as optional and registers delayed slots once", () => {
	const client = loadClientBundle();
	assert.deepEqual(Array.from(client.inject), []);
	let receiveSlots;
	let cleanup;
	const context = {
		inject(names, callback) {
			assert.deepEqual(Array.from(names), ["slots"]);
			receiveSlots = callback;
			return () => undefined;
		},
		effect(factory) { cleanup = factory(); },
	};
	client.apply(context);
	const counter = slotsCounter();
	receiveSlots({ slots: counter.slots });
	receiveSlots({ slots: counter.slots });
	client.apply(context);
	assert.deepEqual(counter.counts, { inject: 1, register: 1, dispose: 0 });
	cleanup();
	assert.equal(counter.counts.dispose, 1);
});

test("client adapter uses immediately available slots without requiring host injection", () => {
	const client = loadClientBundle();
	const counter = slotsCounter();
	let cleanup;
	client.apply({ slots: counter.slots, effect(factory) { cleanup = factory(); } });
	assert.deepEqual(counter.counts, { inject: 1, register: 1, dispose: 0 });
	cleanup();
	assert.equal(counter.counts.dispose, 1);
});

test("client adapter can mount again on the same Cordis context after disposal", () => {
	const client = loadClientBundle();
	const counter = slotsCounter();
	let cleanup;
	const context = {
		slots: counter.slots,
		effect(factory) { cleanup = factory(); },
	};
	client.apply(context);
	cleanup();
	client.apply(context);
	assert.deepEqual(counter.counts, { inject: 2, register: 2, dispose: 1 });
	cleanup();
	assert.equal(counter.counts.dispose, 2);
});
