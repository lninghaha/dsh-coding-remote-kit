import assert from "node:assert/strict";
import test from "node:test";
import { AuthFailureLimiter } from "../lib/server/auth-failure-limiter.js";

test("AuthFailureLimiter blocks after the configured failure budget", () => {
	const limiter = new AuthFailureLimiter({ limit: 3, windowMs: 60_000 });
	const now = 1_000_000;
	assert.equal(limiter.blocked("10.0.0.1", now), false);
	limiter.recordFailure("10.0.0.1", now);
	limiter.recordFailure("10.0.0.1", now + 1);
	limiter.recordFailure("10.0.0.1", now + 2);
	assert.equal(limiter.blocked("10.0.0.1", now + 3), true);
	assert.equal(limiter.blocked("10.0.0.2", now + 3), false);
	assert.equal(limiter.blocked("10.0.0.1", now + 60_001), false);
});
