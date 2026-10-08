import assert from "node:assert/strict"
import test from "node:test"

import {
  computeMissingBands,
  decorateChartRows,
  lossLaneKey,
  lossLaneY,
  lossMarkers,
  pingTooltipModel,
  sampleCompleteness,
  tasksLostAt,
} from "../src/lib/ping-gaps.ts"

const SEC = 1000
const T0 = 1_700_000_000_000

function series(key: string, intervalSec: number | null | undefined, times: number[], lostAt: number[] = []) {
  return {
    key,
    intervalSec,
    points: times.map((time) => ({ time, lost: lostAt.includes(time) })),
  }
}

function every(start: number, end: number, stepSec: number): number[] {
  const out: number[] = []
  for (let t = start; t <= end; t += stepSec * SEC) out.push(t)
  return out
}

test("evenly spaced records produce no missing band", () => {
  const times = every(T0, T0 + 600 * SEC, 60)
  const bands = computeMissingBands([series("a", 60, times)], { now: T0 + 600 * SEC + 30 * SEC })
  assert.deepEqual(bands, [])
})

test("a hole longer than 1.5x interval becomes a band between the surrounding records", () => {
  const times = [...every(T0, T0 + 300 * SEC, 60), ...every(T0 + 600 * SEC, T0 + 900 * SEC, 60)]
  const bands = computeMissingBands([series("a", 60, times)], { now: T0 + 900 * SEC })
  assert.deepEqual(bands, [{ start: T0 + 300 * SEC, end: T0 + 600 * SEC }])
})

test("a gap of exactly 1.5x interval is not missing, just above it is", () => {
  const exact = computeMissingBands([series("a", 60, [T0, T0 + 90 * SEC])], { now: T0 + 90 * SEC })
  assert.deepEqual(exact, [])
  const above = computeMissingBands([series("a", 60, [T0, T0 + 91 * SEC])], { now: T0 + 91 * SEC })
  assert.deepEqual(above, [{ start: T0, end: T0 + 91 * SEC }])
})

test("a missing tail up to now is a band, a short tail is not", () => {
  const times = every(T0, T0 + 300 * SEC, 60)
  const last = T0 + 300 * SEC
  assert.deepEqual(computeMissingBands([series("a", 60, times)], { now: last + 600 * SEC }), [
    { start: last, end: last + 600 * SEC },
  ])
  assert.deepEqual(computeMissingBands([series("a", 60, times)], { now: last + 80 * SEC }), [])
})

test("time before the earliest record is never counted as missing", () => {
  const bands = computeMissingBands([series("a", 60, every(T0 + 3600 * SEC, T0 + 3900 * SEC, 60))], {
    now: T0 + 3900 * SEC,
  })
  assert.deepEqual(bands, [])
})

test("lost (-1) records are present records, so they never create a band", () => {
  const times = every(T0, T0 + 600 * SEC, 60)
  const lost = times.slice(2, 7)
  const s = series("a", 60, times, lost)
  assert.deepEqual(computeMissingBands([s], { now: T0 + 600 * SEC }), [])
  assert.deepEqual(
    lossMarkers([s]).map((m) => m.time),
    lost,
  )
})

test("with several tasks a band is drawn only where every task is missing", () => {
  const a = [...every(T0, T0 + 300 * SEC, 60), ...every(T0 + 900 * SEC, T0 + 1200 * SEC, 60)]
  const b = [...every(T0, T0 + 360 * SEC, 60), ...every(T0 + 840 * SEC, T0 + 1200 * SEC, 60)]
  const bands = computeMissingBands([series("a", 60, a), series("b", 60, b)], { now: T0 + 1200 * SEC })
  // a is missing (300, 900), b is missing (360, 840): overlap is (360, 840)
  assert.deepEqual(bands, [{ start: T0 + 360 * SEC, end: T0 + 840 * SEC }])
})

test("a hole in only one of the tasks draws no band", () => {
  const a = [...every(T0, T0 + 300 * SEC, 60), ...every(T0 + 900 * SEC, T0 + 1200 * SEC, 60)]
  const b = every(T0, T0 + 1200 * SEC, 60)
  assert.deepEqual(computeMissingBands([series("a", 60, a), series("b", 60, b)], { now: T0 + 1200 * SEC }), [])
})

test("each task uses its own interval", () => {
  const slow = every(T0, T0 + 1200 * SEC, 300)
  const fast = [...every(T0, T0 + 300 * SEC, 30), ...every(T0 + 600 * SEC, T0 + 1200 * SEC, 30)]
  // the slow task has no hole at 5 min spacing; the fast task does, but the slow one is present
  assert.deepEqual(
    computeMissingBands([series("slow", 300, slow), series("fast", 30, fast)], { now: T0 + 1200 * SEC }),
    [],
  )
})

test("a task created later does not make earlier time missing for the others", () => {
  const early = every(T0, T0 + 1200 * SEC, 60)
  const late = every(T0 + 600 * SEC, T0 + 1200 * SEC, 60)
  assert.deepEqual(computeMissingBands([series("e", 60, early), series("l", 60, late)], { now: T0 + 1200 * SEC }), [])
})

test("downsampled data uses the bucket width as the minimum step", () => {
  const bucket = 480 * SEC
  const times = every(T0, T0 + 4 * bucket, 480)
  assert.deepEqual(computeMissingBands([series("a", 60, times)], { now: T0 + 4 * bucket, minStepMs: bucket }), [])
  const holey = [T0, T0 + bucket, T0 + 4 * bucket]
  assert.deepEqual(computeMissingBands([series("a", 60, holey)], { now: T0 + 4 * bucket, minStepMs: bucket }), [
    { start: T0 + bucket, end: T0 + 4 * bucket },
  ])
})

test("missing or invalid interval does not throw and falls back to observed spacing", () => {
  const times = [...every(T0, T0 + 300 * SEC, 60), ...every(T0 + 900 * SEC, T0 + 1200 * SEC, 60)]
  for (const interval of [undefined, null, 0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const bands = computeMissingBands([series("a", interval, times)], { now: T0 + 1200 * SEC })
    assert.deepEqual(bands, [{ start: T0 + 300 * SEC, end: T0 + 900 * SEC }])
  }
  assert.deepEqual(computeMissingBands([series("a", undefined, [T0])], { now: T0 + 9999 * SEC }), [])
})

test("empty input and series without points do not throw", () => {
  assert.deepEqual(computeMissingBands([], { now: T0 }), [])
  assert.deepEqual(computeMissingBands([series("a", 60, [])], { now: T0 }), [])
  assert.deepEqual(lossMarkers([]), [])
  assert.deepEqual(lossMarkers([series("a", 60, [])]), [])
  assert.deepEqual(computeMissingBands([series("a", 60, [T0, Number.NaN, T0 + 60 * SEC])], { now: T0 + 60 * SEC }), [])
})

test("unsorted points are handled", () => {
  const times = [T0 + 600 * SEC, T0, T0 + 60 * SEC]
  assert.deepEqual(computeMissingBands([series("a", 60, times)], { now: T0 + 600 * SEC }), [
    { start: T0 + 60 * SEC, end: T0 + 600 * SEC },
  ])
})

test("sample completeness is records over expected records", () => {
  // 60 minutes at 60s: 60 expected
  assert.equal(sampleCompleteness({ records: 30, firstTime: T0, windowEnd: T0 + 3600 * SEC, intervalSec: 60 }), 0.5)
  assert.equal(sampleCompleteness({ records: 60, firstTime: T0, windowEnd: T0 + 3600 * SEC, intervalSec: 60 }), 1)
})

test("sample completeness counts from the first record, not the window start (task created mid-window)", () => {
  // window is 1h but the task's first record is 30 minutes in: 30 expected
  const windowEnd = T0 + 3600 * SEC
  assert.equal(sampleCompleteness({ records: 30, firstTime: T0 + 1800 * SEC, windowEnd, intervalSec: 60 }), 1)
  assert.equal(sampleCompleteness({ records: 15, firstTime: T0 + 1800 * SEC, windowEnd, intervalSec: 60 }), 0.5)
})

test("sample completeness caps at 100% and expects at least one record", () => {
  assert.equal(sampleCompleteness({ records: 500, firstTime: T0, windowEnd: T0 + 600 * SEC, intervalSec: 60 }), 1)
  // very short span: floor gives 0, clamped to 1 expected
  assert.equal(sampleCompleteness({ records: 1, firstTime: T0, windowEnd: T0 + 10 * SEC, intervalSec: 60 }), 1)
  assert.equal(sampleCompleteness({ records: 0, firstTime: T0, windowEnd: T0 + 10 * SEC, intervalSec: 60 }), 0)
})

test("sample completeness floors the expected count at the window edge", () => {
  // 119 s at 60 s: floor(1.98) = 1 expected
  assert.equal(sampleCompleteness({ records: 1, firstTime: T0, windowEnd: T0 + 119 * SEC, intervalSec: 60 }), 1)
  // 120 s at 60 s: 2 expected
  assert.equal(sampleCompleteness({ records: 1, firstTime: T0, windowEnd: T0 + 120 * SEC, intervalSec: 60 }), 0.5)
})

test("sample completeness returns null without usable inputs instead of throwing", () => {
  const base = { records: 10, firstTime: T0, windowEnd: T0 + 600 * SEC, intervalSec: 60 }
  assert.equal(sampleCompleteness({ ...base, intervalSec: undefined }), null)
  assert.equal(sampleCompleteness({ ...base, intervalSec: null }), null)
  assert.equal(sampleCompleteness({ ...base, intervalSec: 0 }), null)
  assert.equal(sampleCompleteness({ ...base, intervalSec: -1 }), null)
  assert.equal(sampleCompleteness({ ...base, intervalSec: Number.NaN }), null)
  assert.equal(sampleCompleteness({ ...base, firstTime: null }), null)
  assert.equal(sampleCompleteness({ ...base, records: Number.NaN }), null)
  // window end before the first record (clock skew) still expects one record
  assert.equal(sampleCompleteness({ ...base, windowEnd: T0 - 5 * SEC }), 1)
})

test("loss markers are listed per task in time order", () => {
  const markers = lossMarkers([series("a", 60, [T0, T0 + 60 * SEC, T0 + 120 * SEC], [T0 + 120 * SEC]), series("b", 60, [T0 + 30 * SEC], [T0 + 30 * SEC])])
  assert.deepEqual(markers, [
    { key: "b", time: T0 + 30 * SEC },
    { key: "a", time: T0 + 120 * SEC },
  ])
})

test("tasksLostAt lists only the tasks that lost a probe at that moment", () => {
  const a = series("a", 60, [T0, T0 + 60 * SEC], [T0 + 60 * SEC])
  const b = series("b", 60, [T0, T0 + 60 * SEC], [T0 + 60 * SEC])
  const c = series("c", 60, [T0, T0 + 60 * SEC])
  assert.deepEqual(tasksLostAt([a, b, c], T0 + 60 * SEC), ["a", "b"])
  assert.deepEqual(tasksLostAt([a, b, c], T0), [])
})

test("tasksLostAt names a single lost task and ignores tasks without a record at that time", () => {
  const a = series("a", 60, [T0, T0 + 60 * SEC], [T0])
  const b = series("b", 60, [T0 + 60 * SEC])
  assert.deepEqual(tasksLostAt([a, b], T0), ["a"])
  // b has no record at T0 and a is fine at T0 + 60: nobody lost
  assert.deepEqual(tasksLostAt([a, b], T0 + 60 * SEC), [])
  assert.deepEqual(tasksLostAt([a, b], T0 + 30 * SEC), [])
  assert.deepEqual(tasksLostAt([], T0), [])
  assert.deepEqual(tasksLostAt([a], Number.NaN), [])
})

test("each displayed task gets its own packet-loss lane, stacked upwards inside the chart", () => {
  for (const count of [1, 2, 4, 12]) {
    const ys = Array.from({ length: count }, (_, index) => lossLaneY(index, count))
    assert.deepEqual([...ys].sort((x, y) => x - y), ys, "first task is the lowest lane")
    assert.equal(new Set(ys).size, count)
    for (const y of ys) assert.ok(y > 0 && y < 0.3, `lane ${y} stays near the bottom`)
  }
  // the lanes are spaced out, not touching
  assert.ok(lossLaneY(1, 4) - lossLaneY(0, 4) >= 0.03)
})

test("decorateChartRows puts a loss lane value per task on rows where that task lost, and gap rows inside bands", () => {
  const rows = [
    { created_at: T0, a: 10, b: 20 },
    { created_at: T0 + 60 * SEC, a: null, b: 21 },
    { created_at: T0 + 600 * SEC, a: 12, b: 22 },
  ]
  const out = decorateChartRows(rows, {
    keys: ["a", "b"],
    markers: [{ key: "a", time: T0 + 60 * SEC }],
    bands: [{ start: T0 + 60 * SEC, end: T0 + 600 * SEC }],
  })
  const lossRow = out.find((r) => r.created_at === T0 + 60 * SEC)
  assert.equal(lossRow?.[lossLaneKey("a")], lossLaneY(0, 2))
  assert.equal(lossRow?.[lossLaneKey("b")], undefined, "b did not lose, so b's lane stays empty")
  assert.equal(out.find((r) => r.created_at === T0)?.[lossLaneKey("a")], undefined)
  const gapRows = out.filter((r) => r.gap_band !== undefined)
  assert.ok(gapRows.length >= 1)
  for (const row of gapRows) {
    assert.ok(row.created_at > T0 + 60 * SEC && row.created_at < T0 + 600 * SEC)
    assert.equal(row.a, undefined)
  }
  const times = out.map((r) => r.created_at)
  assert.deepEqual(times, [...times].sort((x, y) => x - y))
  assert.equal(rows.length, 3, "input is not mutated")
})

test("a task with 100% loss fills only its own lane", () => {
  const times = every(T0, T0 + 300 * SEC, 60)
  const all = series("all", 60, times, times)
  const some = series("some", 60, times, [times[2]])
  const rows = times.map((t) => ({ created_at: t }))
  const out = decorateChartRows(rows, { keys: ["all", "some"], markers: lossMarkers([all, some]), bands: [] })
  assert.equal(out.filter((r) => r[lossLaneKey("all")] !== undefined).length, times.length)
  assert.equal(out.filter((r) => r[lossLaneKey("some")] !== undefined).length, 1)
})

const fmtTime = (time: number) => `t=${time}`

test("tooltip inside a missing band shows the time label and the no-record line, without task values", () => {
  const band = { start: T0 + 60 * SEC, end: T0 + 600 * SEC }
  const a = series("a", 60, [T0, T0 + 60 * SEC, T0 + 600 * SEC])
  const model = pingTooltipModel({ time: T0 + 300 * SEC, bands: [band], series: [a], formatTime: fmtTime })
  assert.equal(model.label, `t=${T0 + 300 * SEC}`)
  assert.deepEqual(model.lines, [{ kind: "no-record" }])
  assert.equal(model.showValues, false)
})

test("tooltip outside a band shows the time label and the task values", () => {
  const band = { start: T0 + 60 * SEC, end: T0 + 600 * SEC }
  const a = series("a", 60, [T0, T0 + 60 * SEC, T0 + 600 * SEC])
  const model = pingTooltipModel({ time: T0, bands: [band], series: [a], formatTime: fmtTime })
  assert.equal(model.label, `t=${T0}`)
  assert.equal(model.showValues, true)
  assert.ok(!model.lines.some((line) => line.kind === "no-record"))
})

test("tooltip has no packet-loss line when no task lost, and names the tasks that did", () => {
  const a = series("a", 60, [T0, T0 + 60 * SEC], [T0 + 60 * SEC])
  const b = series("b", 60, [T0, T0 + 60 * SEC])
  const none = pingTooltipModel({ time: T0, bands: [], series: [a, b], formatTime: fmtTime })
  assert.deepEqual(none.lines, [])
  const some = pingTooltipModel({ time: T0 + 60 * SEC, bands: [], series: [a, b], formatTime: fmtTime })
  assert.deepEqual(some.lines, [{ kind: "loss", keys: ["a"] }])
})

test("band edges are not inside the band, so the edge record keeps its values", () => {
  const band = { start: T0, end: T0 + 600 * SEC }
  const model = pingTooltipModel({ time: T0, bands: [band], series: [], formatTime: fmtTime })
  assert.equal(model.showValues, true)
  assert.deepEqual(pingTooltipModel({ time: T0 + 600 * SEC, bands: [band], series: [], formatTime: fmtTime }).lines, [])
})
