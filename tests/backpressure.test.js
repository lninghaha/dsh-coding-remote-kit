import assert from "node:assert/strict";
import test from "node:test";
import { exceedsHardLimit, exceedsSoftLimit, FrameQueue } from "../lib/server/backpressure.js";
import { HARD_QUEUE_LIMIT, MAX_QUEUED_FRAMES, SOFT_BUFFER_LIMIT } from "../lib/shared/constants.js";

test("soft limit: queue above 8MiB, send at or below", () => {
	assert.equal(exceedsSoftLimit(SOFT_BUFFER_LIMIT), false);
	assert.equal(exceedsSoftLimit(SOFT_BUFFER_LIMIT + 1), true);
});

test("hard limit: overflow above 64MiB or 4096 frames", () => {
	assert.equal(exceedsHardLimit(HARD_QUEUE_LIMIT, 0), false);
	assert.equal(exceedsHardLimit(HARD_QUEUE_LIMIT + 1, 0), true);
	assert.equal(exceedsHardLimit(0, MAX_QUEUED_FRAMES), false);
	assert.equal(exceedsHardLimit(0, MAX_QUEUED_FRAMES + 1), true);
});

test("FrameQueue buffers when the socket is full and encrypts only at drain", () => {
	let buffered = 0;
	const sent = [];
	const sink = {
		get bufferedAmount() {
			return buffered;
		},
		send(data) {
			sent.push(data);
		},
		close() {},
	};
	let encodes = 0;
	const queue = new FrameQueue(sink, (payload) => {
		encodes += 1;
		return payload;
	});

	buffered = SOFT_BUFFER_LIMIT + 1;
	assert.equal(queue.enqueue(new Uint8Array([1])), "queued");
	assert.equal(sent.length, 0);
	assert.equal(encodes, 0);

	buffered = 0;
	queue.drain();
	assert.equal(sent.length, 1);
	assert.equal(encodes, 1);
});

test("FrameQueue hard overflow closes the socket with 1013", () => {
	let closedCode = 0;
	const sink = {
		get bufferedAmount() {
			return SOFT_BUFFER_LIMIT + 1;
		},
		send() {},
		close(code) {
			closedCode = code;
		},
	};
	const queue = new FrameQueue(sink, (payload) => payload);
	let overflowed = false;
	for (let i = 0; i < MAX_QUEUED_FRAMES + 2; i += 1) {
		if (queue.enqueue(new Uint8Array([1])) === "overflow") {
			overflowed = true;
			break;
		}
	}
	assert.equal(overflowed, true);
	assert.equal(closedCode, 1013);
});
