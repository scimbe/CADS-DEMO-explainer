import { test } from "node:test";
import assert from "node:assert/strict";
import { mapLimit, resolveConcurrency } from "../src/util/concurrency.mjs";

const tick = (ms) => new Promise((r) => setTimeout(r, ms));

test("mapLimit preserves input order even when tasks finish out of order", async () => {
  // Earlier items resolve later, so completion order != input order.
  const out = await mapLimit([30, 10, 20, 5], 2, async (ms, i) => {
    await tick(ms);
    return `${i}:${ms}`;
  });
  assert.deepEqual(out, ["0:30", "1:10", "2:20", "3:5"]);
});

test("mapLimit never runs more than `limit` tasks at once", async () => {
  let inFlight = 0;
  let peak = 0;
  await mapLimit(Array.from({ length: 12 }, (_, i) => i), 3, async () => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await tick(5);
    inFlight--;
  });
  assert.equal(peak, 3);
});

test("mapLimit clamps the worker count to the number of items", async () => {
  let inFlight = 0;
  let peak = 0;
  await mapLimit([1, 2], 8, async () => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await tick(5);
    inFlight--;
  });
  assert.equal(peak, 2);
});

test("mapLimit returns [] for empty input and never calls fn", async () => {
  let called = false;
  const out = await mapLimit([], 3, async () => { called = true; });
  assert.deepEqual(out, []);
  assert.equal(called, false);
});

test("mapLimit propagates the first task error", async () => {
  await assert.rejects(
    () => mapLimit([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error("boom");
      await tick(1);
    }),
    /boom/,
  );
});

test("resolveConcurrency defaults to 3 when unset", () => {
  assert.equal(resolveConcurrency(undefined), 3);
});

test("resolveConcurrency honors an explicit numeric option", () => {
  assert.equal(resolveConcurrency(2), 2);
});

test("resolveConcurrency caps at the hard max of 4 (never unbounded)", () => {
  assert.equal(resolveConcurrency(99), 4);
});

test("resolveConcurrency floors below-1 or garbage values back to the default", () => {
  assert.equal(resolveConcurrency(0), 3);
  assert.equal(resolveConcurrency(-5), 3);
  assert.equal(resolveConcurrency("nonsense"), 3);
});

test("resolveConcurrency reads the named env var when no option is given", () => {
  const key = "TEST_CONC_ENV_VAR";
  process.env[key] = "2";
  try {
    assert.equal(resolveConcurrency(undefined, key), 2);
  } finally {
    delete process.env[key];
  }
});

test("resolveConcurrency lets an explicit option win over the env var", () => {
  const key = "TEST_CONC_ENV_VAR2";
  process.env[key] = "4";
  try {
    assert.equal(resolveConcurrency(2, key), 2);
  } finally {
    delete process.env[key];
  }
});
