import assert from "node:assert/strict"
import test from "node:test"

import { HISTORY_TIME_OPTIONS, historyMaxPoints } from "../src/lib/history-range.ts"
import { mergeResourceSeries, usagePercent } from "../src/lib/resource-history.ts"

test("keeps the same history ranges as the latency chart", () => {
  assert.deepEqual(
    HISTORY_TIME_OPTIONS.map((option) => option.label),
    ["1h", "6h", "12h", "24h", "3d", "7d", "30d"],
  )
  assert.equal(historyMaxPoints(1), 90)
  assert.equal(historyMaxPoints(24), 180)
})

test("converts used bytes into resource percentages", () => {
  assert.equal(usagePercent(16 * 1024 ** 3, 32 * 1024 ** 3), 50)
  assert.equal(usagePercent(18.7, 0), 18.7)
})

test("merges cpu memory and disk series onto a shared timeline", () => {
  const points = mergeResourceSeries(
    [{ time: 1000, value: 18.7 }],
    [{ time: 1000, value: 19.2 * 1024 ** 3 }],
    [{ time: 2000, value: 95.6 * 1024 ** 3 }],
    { memTotal: 32 * 1024 ** 3, diskTotal: 400 * 1024 ** 3, swapTotal: 0 },
  )

  assert.equal(points.length, 2)
  assert.equal(points[0].cpu, 18.7)
  assert.ok(Math.abs((points[0].memory || 0) - 60) < 0.1)
  assert.equal(points[0].storage, null)
  assert.equal(points[0].swap, null)
  assert.equal(points[0].tcp, null)
  assert.equal(points[1].cpu, null)
  assert.ok(Math.abs((points[1].storage || 0) - 23.9) < 0.1)
})

test("overlays swap percent and connection counts on the same timeline", () => {
  const points = mergeResourceSeries(
    [{ time: 1000, value: 10 }],
    [{ time: 1000, value: 8 * 1024 ** 3 }],
    [{ time: 1000, value: 40 * 1024 ** 3 }],
    { memTotal: 16 * 1024 ** 3, diskTotal: 200 * 1024 ** 3, swapTotal: 4 * 1024 ** 3 },
    {
      swapUsed: [{ time: 1000, value: 1 * 1024 ** 3 }],
      tcp: [{ time: 1000, value: 128 }],
      udp: [{ time: 2000, value: 17 }],
    },
  )

  assert.equal(points.length, 2)
  assert.equal(points[0].swap, 25)
  assert.equal(points[0].tcp, 128)
  assert.equal(points[0].udp, null)
  assert.equal(points[1].tcp, null)
  assert.equal(points[1].udp, 17)
})
