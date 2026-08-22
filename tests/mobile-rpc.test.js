import assert from "node:assert/strict";
import test from "node:test";
import { MobileRpcClient } from "../lib/mobile/rpc.js";

test("RpcClient.onPush disposer removes only its own subscription", () => {
	const client = new MobileRpcClient(() => undefined);
	const first = [];
	const second = [];
	const disposeFirst = client.onPush((push) => first.push(push.push));
	const disposeSecond = client.onPush((push) => second.push(push.push));

	client.handleMessage({ push: "host.event", data: {} });
	disposeFirst();
	disposeFirst();
	client.handleMessage({ push: "session.event", data: {} });

	assert.deepEqual(first, ["host.event"]);
	assert.deepEqual(second, ["host.event", "session.event"]);
	disposeSecond();
});

test("RpcClient rejects requests created after disconnect", async () => {
	let sends = 0;
	const client = new MobileRpcClient(() => { sends += 1; });
	client.failAll("disconnected");
	await assert.rejects(client.request("session.list"), /disconnected/);
	assert.equal(sends, 0);
});
