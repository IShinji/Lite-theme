import assert from "node:assert/strict"
import test from "node:test"

import {
  applyHomeProbeTaskOrder,
  homeProbeOverrideIds,
  normalizeHomeProbeTaskIds,
  parseHomeProbeTaskOverrides,
} from "../src/lib/home-probe-tasks.ts"
import type { HomeLatencyTaskSummary } from "../src/lib/home-latency.ts"

function summary(taskId: string, taskName = taskId): HomeLatencyTaskSummary {
  return {
    taskId,
    taskName,
    latency: 12,
    packetLoss: 0,
    latencyHistory: [],
    packetLossHistory: [],
    updatedAt: 1,
  }
}

test("keeps at most four unique positive probe task ids in the given order", () => {
  assert.deepEqual(normalizeHomeProbeTaskIds(["3", 1, 1, 0, -2, 4, 2, 9, "nope"]), [3, 1, 4, 2])
  assert.deepEqual(normalizeHomeProbeTaskIds(undefined), [])
})

test("parses per-server homepage probe overrides and ignores empty selections", () => {
  assert.deepEqual(
    parseHomeProbeTaskOverrides({
      "Node-A": [2, 1, 2, 8],
      "node-b": [],
      "": [1],
    }),
    { "Node-A": [2, 1, 8] },
  )
  assert.deepEqual(parseHomeProbeTaskOverrides('{"uuid-1":["4","5"]}'), { "uuid-1": [4, 5] })
  assert.deepEqual(parseHomeProbeTaskOverrides("nope"), {})
})

test("matches override keys without requiring the same uuid case", () => {
  const overrides = parseHomeProbeTaskOverrides({ "AbC": [7, 3] })
  assert.deepEqual(homeProbeOverrideIds(overrides, "abc"), [7, 3])
  assert.deepEqual(homeProbeOverrideIds(overrides, "missing"), [])
})

test("reorders homepage probes by the saved task ids and falls back when none match", () => {
  const items = [summary("1", "Tokyo"), summary("2", "Osaka"), summary("3", "Seoul")]
  assert.deepEqual(
    applyHomeProbeTaskOrder(items, [3, 1]).map((item) => item.taskName),
    ["Seoul", "Tokyo"],
  )
  assert.equal(applyHomeProbeTaskOrder(items, [9, 8]), items)
  assert.equal(applyHomeProbeTaskOrder(items, []), items)
})
