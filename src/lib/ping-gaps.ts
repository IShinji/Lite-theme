// Pure helpers that tell apart two different reasons a latency line is broken:
//   - packet loss: the probe ran but got no reply (the backend stores value = -1), and
//   - a missing record: nothing was stored for that moment at all (the probe command never
//     reached the agent, or the result never came back).
// Timestamps are milliseconds, intervals are seconds (as returned by the ping task API).

/** A record counts as missing once the spacing exceeds this many task intervals. */
export const GAP_INTERVAL_FACTOR = 1.5

/** Y value (on the hidden 0..1 marker axis) of the invisible rows that carry the band hover text. */
export const GAP_ROW_Y = 0.04

const LOSS_LANE_BASE = 0.03
const LOSS_LANE_STEP = 0.045
const LOSS_LANE_MAX_HEIGHT = 0.2

/** Name of the row field holding a task's packet-loss lane position. */
export function lossLaneKey(key: string): string {
  return `loss__${key}`
}

/**
 * Y position (0..1 hidden axis) of a task's packet-loss lane. Every displayed task owns a lane,
 * the first task is the lowest, and the lanes share at most a fifth of the plot height.
 */
export function lossLaneY(index: number, count: number): number {
  const step = Math.min(LOSS_LANE_STEP, LOSS_LANE_MAX_HEIGHT / Math.max(1, count))
  return LOSS_LANE_BASE + index * step
}

export type PingGapPoint = { time: number; lost?: boolean }

export type PingGapSeries = {
  key: string
  /** Task interval in seconds. Missing or invalid values fall back to the observed spacing. */
  intervalSec?: number | null
  points: PingGapPoint[]
}

export type TimeBand = { start: number; end: number }
export type LossMarker = { key: string; time: number }

type Span = [number, number]

function validTimes(points: PingGapPoint[]): number[] {
  return points
    .map((point) => point.time)
    .filter((time) => typeof time === "number" && Number.isFinite(time))
    .sort((a, b) => a - b)
}

function medianSpacing(times: number[]): number | null {
  const spacings: number[] = []
  for (let i = 1; i < times.length; i++) {
    const spacing = times[i] - times[i - 1]
    if (spacing > 0) spacings.push(spacing)
  }
  if (spacings.length === 0) return null
  spacings.sort((a, b) => a - b)
  const mid = Math.floor(spacings.length / 2)
  return spacings.length % 2 ? spacings[mid] : (spacings[mid - 1] + spacings[mid]) / 2
}

function expectedStepMs(intervalSec: number | null | undefined, times: number[], minStepMs: number): number | null {
  const fromInterval =
    typeof intervalSec === "number" && Number.isFinite(intervalSec) && intervalSec > 0 ? intervalSec * 1000 : null
  const base = fromInterval ?? medianSpacing(times)
  if (base === null) return null
  return Math.max(base, minStepMs)
}

function missingSpans(series: PingGapSeries, now: number, minStepMs: number): Span[] | null {
  const times = validTimes(series.points)
  if (times.length === 0) return null
  const step = expectedStepMs(series.intervalSec, times, minStepMs)
  const spans: Span[] = []
  if (step === null) return spans
  const limit = step * GAP_INTERVAL_FACTOR
  for (let i = 1; i < times.length; i++) {
    if (times[i] - times[i - 1] > limit) spans.push([times[i - 1], times[i]])
  }
  const last = times[times.length - 1]
  if (Number.isFinite(now) && now - last > limit) spans.push([last, now])
  return spans
}

function intersectSpans(left: Span[], right: Span[]): Span[] {
  const out: Span[] = []
  let i = 0
  let j = 0
  while (i < left.length && j < right.length) {
    const start = Math.max(left[i][0], right[j][0])
    const end = Math.min(left[i][1], right[j][1])
    if (end > start) out.push([start, end])
    if (left[i][1] < right[j][1]) i++
    else j++
  }
  return out
}

/**
 * Time ranges in which every displayed task has no record. A task only counts from its own
 * earliest record onwards (time before it was created is not "missing"), and a task without any
 * record carries no information, so it is ignored. Ranges where only some tasks are missing are
 * deliberately not returned: the broken line already shows those.
 *
 * `minStepMs` is the width of one downsampled bucket, so coarse windows do not flag every bucket.
 */
export function computeMissingBands(
  series: PingGapSeries[],
  options: { now: number; minStepMs?: number },
): TimeBand[] {
  const minStepMs = Number.isFinite(options.minStepMs) && (options.minStepMs as number) > 0 ? (options.minStepMs as number) : 0
  let common: Span[] | null = null
  for (const item of series) {
    const spans = missingSpans(item, options.now, minStepMs)
    if (spans === null) continue
    common = common === null ? spans : intersectSpans(common, spans)
    if (common.length === 0) return []
  }
  return (common ?? []).map(([start, end]) => ({ start, end }))
}

/** Every record that is a packet loss (the probe ran, nothing came back), oldest first. */
export function lossMarkers(series: PingGapSeries[]): LossMarker[] {
  const markers: LossMarker[] = []
  for (const item of series) {
    for (const point of item.points) {
      if (point.lost && Number.isFinite(point.time)) markers.push({ key: item.key, time: point.time })
    }
  }
  return markers.sort((a, b) => a.time - b.time)
}

/**
 * Records received divided by records expected, between 0 and 1, or null when it cannot be told.
 * Expected = floor((windowEnd - firstTime) / interval), at least 1: counting starts at the task's
 * earliest record so a task created mid-window is not penalised for the time before it existed.
 */
export function sampleCompleteness(input: {
  records: number
  firstTime: number | null | undefined
  windowEnd: number
  intervalSec: number | null | undefined
}): number | null {
  const { records, firstTime, windowEnd, intervalSec } = input
  if (typeof intervalSec !== "number" || !Number.isFinite(intervalSec) || intervalSec <= 0) return null
  if (typeof firstTime !== "number" || !Number.isFinite(firstTime) || !Number.isFinite(windowEnd)) return null
  if (!Number.isFinite(records) || records < 0) return null
  const expected = Math.max(1, Math.floor((windowEnd - firstTime) / (intervalSec * 1000)))
  return Math.min(1, records / expected)
}

/** Keys of the tasks that have a packet-loss record exactly at `time`. Tasks without a record then are not listed. */
export function tasksLostAt(series: PingGapSeries[], time: number): string[] {
  if (!Number.isFinite(time)) return []
  return series.filter((item) => item.points.some((point) => point.time === time && point.lost)).map((item) => item.key)
}

export type PingTooltipLine = { kind: "no-record" } | { kind: "loss"; keys: string[] }

/**
 * What the hover tooltip shows at `time`: always the time label; inside a missing band only the
 * no-record line (no task values); outside, the tasks that lost a probe then (no line if none did).
 */
export function pingTooltipModel(input: {
  time: number
  bands: TimeBand[]
  series: PingGapSeries[]
  formatTime: (time: number) => string
}): { label: string; lines: PingTooltipLine[]; showValues: boolean } {
  const { time, bands, series, formatTime } = input
  const label = formatTime(time)
  if (bands.some((band) => time > band.start && time < band.end)) {
    return { label, lines: [{ kind: "no-record" }], showValues: false }
  }
  const keys = tasksLostAt(series, time)
  return { label, lines: keys.length > 0 ? [{ kind: "loss", keys }] : [], showValues: true }
}

export type ChartRow = { created_at: number; [key: string]: number | null | undefined }

/**
 * Adds what the chart needs on top of the plain latency rows (the input is not modified):
 *  - a per-task `loss__<key>` value on rows where that task lost a probe, so each task draws its
 *    losses on its own lane (`keys` is the displayed tasks, in legend order);
 *  - a few empty `gap_band` rows inside every missing band, so the lines really break there and
 *    hovering the grey band has something to show.
 */
export function decorateChartRows(
  rows: ChartRow[],
  options: { keys: string[]; markers: LossMarker[]; bands: TimeBand[] },
): ChartRow[] {
  const lanes = new Map(options.keys.map((key, index) => [key, lossLaneY(index, options.keys.length)]))
  const lossByTime = new Map<number, Array<[string, number]>>()
  for (const marker of options.markers) {
    const lane = lanes.get(marker.key)
    if (lane === undefined) continue
    const list = lossByTime.get(marker.time) || []
    list.push([lossLaneKey(marker.key), lane])
    lossByTime.set(marker.time, list)
  }
  const out: ChartRow[] = rows.map((row) => {
    const losses = lossByTime.get(row.created_at)
    return losses ? { ...row, ...Object.fromEntries(losses) } : row
  })
  for (const band of options.bands) {
    for (let k = 1; k <= 3; k++) {
      const time = Math.round(band.start + ((band.end - band.start) * k) / 4)
      if (time > band.start && time < band.end) out.push({ created_at: time, gap_band: GAP_ROW_Y })
    }
  }
  return out.sort((a, b) => a.created_at - b.created_at)
}
