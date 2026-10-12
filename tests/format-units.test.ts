import assert from "node:assert/strict"
import test from "node:test"

import { formatBytes, formatDelayAxisTick, formatSpeed, splitFormattedMeasure } from "../src/lib/format.ts"

test("displays byte sizes as GB and TB instead of GiB and TiB", () => {
  assert.equal(formatBytes(0), "0 Bytes")
  assert.equal(formatBytes(1024), "1 KB")
  assert.equal(formatBytes(1024 ** 2), "1 MB")
  assert.equal(formatBytes(1024 ** 3), "1 GB")
  assert.equal(formatBytes(1024 ** 4), "1 TB")
  assert.match(formatBytes(2.5 * 1024 ** 3), /GB$/)
  assert.match(formatBytes(3 * 1024 ** 4), /TB$/)
  assert.doesNotMatch(formatBytes(1024 ** 3), /GiB/)
  assert.doesNotMatch(formatBytes(1024 ** 4), /TiB/)
})

test("keeps compact delay ticks distinct on small ranges", () => {
  assert.equal(formatDelayAxisTick(0, true), "0ms")
  assert.equal(formatDelayAxisTick(0.5, true), "0.5ms")
  assert.equal(formatDelayAxisTick(1, true), "1ms")
  assert.equal(formatDelayAxisTick(1.5, true), "1.5ms")
  assert.equal(formatDelayAxisTick(2, true), "2ms")
  assert.equal(formatDelayAxisTick(160.4, true), "160ms")
  assert.equal(formatDelayAxisTick(1.5, false), "1.50ms")
})

test("splits live speed into a number and a visible unit", () => {
  assert.deepEqual(splitFormattedMeasure(formatSpeed(0.945)), { value: "967.68", unit: "K/s" })
  assert.deepEqual(splitFormattedMeasure(formatSpeed(36.3)), { value: "36.30", unit: "M/s" })
  assert.deepEqual(splitFormattedMeasure(formatSpeed(2048)), { value: "2.00", unit: "G/s" })
})
