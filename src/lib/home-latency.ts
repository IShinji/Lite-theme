export interface HomeLatencySample {
  entityId: string
  taskId: string
  taskName: string
  timestamp: number
  latency: number | null
  lossRatio: number
  count: number
}

export interface HomeLatencySummary {
  latency: number | null
  packetLoss: number | null
  latencyHistory: Array<number | null>
  packetLossHistory: Array<number | null>
  updatedAt: number | null
  total?: number | null
  valid?: number | null
  interval?: number | null
}

export interface HomeLatencyTaskSummary extends HomeLatencySummary {
  taskId: string
  taskName: string
}

export type HomeLatencyByServer = Record<string, HomeLatencyTaskSummary[]>

interface SummaryBucket {
  latencySum: number
  latencyCount: number
  lostCount: number
  totalCount: number
}

interface TaskBuckets {
  entityId: string
  taskId: string
  taskName: string
  buckets: Map<number, SummaryBucket>
}

const MINUTE_MS = 60_000
const HOME_BUCKET_MS = 5 * MINUTE_MS
const HOME_LATENCY_CACHE_KEY = "lite-home-latency-v2"
const HOME_LATENCY_CACHE_MAX_AGE_MS = 5 * MINUTE_MS
export const HOME_LATENCY_WINDOW_HOURS = 1
export const HOME_LATENCY_CARD_LIMIT = 4
export const HOME_LATENCY_GREEN_MAX_MS = 80
export const HOME_LATENCY_AMBER_MAX_MS = 180

export const HOME_TWO_COL_MIN = 968
export const HOME_THREE_COL_MIN = 1440
export const HOME_FOUR_COL_MIN = 1920
export const HOME_TWO_COL_WIDTH = 1260
export const HOME_THREE_COL_WIDTH = 1440
export const HOME_FOUR_COL_WIDTH = 1920
export const HOME_CARD_WIDTH = 448
export const HOME_CARD_GAP = 16

export function homePageGutter(width: number): number {
  if (width <= 967) return 32
  if (width <= 1919) return 56
  return 80
}

export function homeCardColumnCount(width: number): number {
  if (width >= HOME_FOUR_COL_MIN) return 4
  if (width >= HOME_THREE_COL_MIN) return 3
  if (width >= HOME_TWO_COL_MIN) return 2
  return 1
}

export function homePageMaxWidth(columns: number): number | null {
  if (columns <= 1) return null
  if (columns === 2) return HOME_TWO_COL_WIDTH
  if (columns === 3) return HOME_THREE_COL_WIDTH
  return HOME_FOUR_COL_WIDTH
}

export function homeCardTrackWidth(columns: number): number | null {
  const maxWidth = homePageMaxWidth(columns)
  if (maxWidth == null) return null
  return maxWidth - (columns >= 4 ? 80 : 56)
}

export function homeProbeRowCount(taskCount: number): number {
  const count = Math.min(HOME_LATENCY_CARD_LIMIT, Math.max(0, taskCount))
  if (count === 0) return 0
  return Math.ceil(count / 2)
}

export function homeProbeShouldStack(taskCounts: number[], index: number, columns: number): boolean {
  if (columns < 2 || index < 0 || index >= taskCounts.length) return false
  const count = Math.min(HOME_LATENCY_CARD_LIMIT, Math.max(0, taskCounts[index] ?? 0))
  if (count !== 2) return false
  const rowStart = Math.floor(index / columns) * columns
  const rowEnd = Math.min(taskCounts.length, rowStart + columns)
  let maxRows = 0
  for (let i = rowStart; i < rowEnd; i++) {
    maxRows = Math.max(maxRows, homeProbeRowCount(taskCounts[i] ?? 0))
  }
  return maxRows >= 2
}

export type LatencyBarTone = "green" | "amber" | "coral" | "empty"

export function latencyBarTone(latency: number | null): LatencyBarTone {
  if (latency === null || !Number.isFinite(latency) || latency < 0) return "empty"
  if (latency >= HOME_LATENCY_AMBER_MAX_MS) return "coral"
  if (latency > HOME_LATENCY_GREEN_MAX_MS) return "amber"
  return "green"
}

export function formatProbePacketLoss(packetLoss: number | null): string {
  if (packetLoss === null || !Number.isFinite(packetLoss) || packetLoss < 0) return "--"
  return `${packetLoss.toFixed(1)}%`
}

export function hourPacketFillPercent(input: { total?: number | null; valid?: number | null; packetLoss?: number | null }): number {
  const total = finiteOrNull(input.total)
  const valid = finiteOrNull(input.valid)
  if (total !== null) {
    if (total <= 0) return 0
    if (valid !== null) return Math.min(100, Math.max(0, (valid / total) * 100))
  }
  if (valid !== null && valid > 0) {
    const loss = finiteOrNull(input.packetLoss)
    if (loss !== null) return Math.min(100, Math.max(0, 100 - loss))
    return 100
  }
  return 0
}

function finiteOrNull(value: unknown): number | null {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export function summarizeHomeLatencySamples(samples: HomeLatencySample[], historyLimit = 12): HomeLatencyByServer {
  const taskBuckets = new Map<string, TaskBuckets>()

  for (const sample of samples) {
    const timestamp = finiteOrNull(sample.timestamp)
    const count = finiteOrNull(sample.count)
    if (!sample.entityId || !sample.taskId || timestamp === null || count === null || count <= 0) continue

    const key = `${sample.entityId}\u0000${sample.taskId}`
    const task = taskBuckets.get(key) || {
      entityId: sample.entityId,
      taskId: sample.taskId,
      taskName: sample.taskName || sample.taskId,
      buckets: new Map<number, SummaryBucket>(),
    }
    const bucketTime = Math.floor(timestamp / HOME_BUCKET_MS) * HOME_BUCKET_MS
    const lossRatio = Math.min(1, Math.max(0, finiteOrNull(sample.lossRatio) ?? 0))
    const bucket = task.buckets.get(bucketTime) || { latencySum: 0, latencyCount: 0, lostCount: 0, totalCount: 0 }
    const validCount = count * (1 - lossRatio)
    const latency = finiteOrNull(sample.latency)

    if (latency !== null && latency >= 0 && validCount > 0) {
      bucket.latencySum += latency * validCount
      bucket.latencyCount += validCount
    }
    bucket.lostCount += count * lossRatio
    bucket.totalCount += count
    task.buckets.set(bucketTime, bucket)
    taskBuckets.set(key, task)
  }

  const summaries: HomeLatencyByServer = {}
  for (const task of taskBuckets.values()) {
    const latestTimestamp = Math.max(...task.buckets.keys())
    const windowSize = Math.max(1, Math.floor(historyLimit))
    const history = Array.from({ length: windowSize }, (_, index) => {
      const timestamp = latestTimestamp - (windowSize - index - 1) * HOME_BUCKET_MS
      const bucket = task.buckets.get(timestamp)
      return {
        timestamp,
        latency: bucket && bucket.latencyCount > 0 ? bucket.latencySum / bucket.latencyCount : null,
        packetLoss: bucket && bucket.totalCount > 0 ? (bucket.lostCount / bucket.totalCount) * 100 : null,
      }
    })
    let windowLostCount = 0
    let windowTotalCount = 0
    for (const item of history) {
      const bucket = task.buckets.get(item.timestamp)
      if (!bucket) continue
      windowLostCount += bucket.lostCount
      windowTotalCount += bucket.totalCount
    }

    const summary: HomeLatencyTaskSummary = {
      taskId: task.taskId,
      taskName: task.taskName,
      latency: history.at(-1)?.latency ?? null,
      packetLoss: windowTotalCount > 0 ? (windowLostCount / windowTotalCount) * 100 : null,
      latencyHistory: history.map((item) => item.latency),
      packetLossHistory: history.map((item) => item.packetLoss),
      updatedAt: latestTimestamp,
      total: windowTotalCount > 0 ? windowTotalCount : null,
      valid: windowTotalCount > 0 ? Math.max(0, windowTotalCount - windowLostCount) : null,
    }
    summaries[task.entityId] = [...(summaries[task.entityId] || []), summary]
  }

  return summaries
}

export interface PingStatForHome {
  entity_id?: string
  task_id?: string
  name?: string
  latest?: number | null
  avg?: number | null
  loss?: number | null
  total?: number | null
  valid?: number | null
  interval?: number | null
}

export function mapPingStatsToHomeLatency(stats: PingStatForHome[], tasks: Array<{ id?: number | string; name?: string }> = []): HomeLatencyByServer {
  const taskNames = new Map(tasks.map((task) => [String(task.id), task.name || `Task ${task.id}`]))
  const taskOrder = new Map(tasks.map((task, index) => [String(task.id), index]))
  const result: HomeLatencyByServer = {}

  for (const stat of stats) {
    const entityId = String(stat.entity_id || "").trim()
    const taskId = String(stat.task_id || "").trim()
    if (!entityId || !taskId) continue

    const total = finiteOrNull(stat.total)
    const valid = finiteOrNull(stat.valid)
    const latencyRaw = finiteOrNull(stat.latest) ?? finiteOrNull(stat.avg)
    const hasSamples = total !== null ? total > 0 : valid !== null ? valid > 0 : latencyRaw !== null
    const latency = hasSamples ? latencyRaw : null
    const packetLoss = hasSamples ? finiteOrNull(stat.loss) : null
    const summary: HomeLatencyTaskSummary = {
      taskId,
      taskName: stat.name || taskNames.get(taskId) || `Task ${taskId}`,
      latency,
      packetLoss,
      latencyHistory: [latency],
      packetLossHistory: [packetLoss],
      updatedAt: hasSamples ? Date.now() : null,
      total,
      valid,
      interval: finiteOrNull(stat.interval),
    }
    result[entityId] = [...(result[entityId] || []), summary]
  }

  for (const entityId of Object.keys(result)) {
    result[entityId].sort((left, right) => {
      const first = taskOrder.get(left.taskId) ?? Number.MAX_SAFE_INTEGER
      const second = taskOrder.get(right.taskId) ?? Number.MAX_SAFE_INTEGER
      return first === second ? left.taskName.localeCompare(right.taskName) : first - second
    })
  }

  return result
}

interface HomeLatencyCachePayload {
  savedAt: number
  data: HomeLatencyByServer
}

type ReadableStorage = Pick<Storage, "getItem">
type WritableStorage = Pick<Storage, "setItem">

function isNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value))
}

function isHistory(value: unknown): value is Array<number | null> {
  return Array.isArray(value) && value.every(isNullableNumber)
}

function isTaskSummary(value: unknown): value is HomeLatencyTaskSummary {
  if (!value || typeof value !== "object") return false
  const summary = value as Partial<HomeLatencyTaskSummary>
  return (
    typeof summary.taskId === "string" &&
    typeof summary.taskName === "string" &&
    isNullableNumber(summary.latency) &&
    isNullableNumber(summary.packetLoss) &&
    isHistory(summary.latencyHistory) &&
    isHistory(summary.packetLossHistory) &&
    isNullableNumber(summary.updatedAt)
  )
}

export function readHomeLatencyCache(storage: ReadableStorage | null, entityIds: string[], now = Date.now()): HomeLatencyByServer | undefined {
  if (!storage || entityIds.length === 0) return undefined

  try {
    const parsed = JSON.parse(storage.getItem(HOME_LATENCY_CACHE_KEY) || "null") as Partial<HomeLatencyCachePayload> | null
    if (!parsed || typeof parsed.savedAt !== "number" || !Number.isFinite(parsed.savedAt)) return undefined
    if (parsed.savedAt > now + MINUTE_MS || now - parsed.savedAt > HOME_LATENCY_CACHE_MAX_AGE_MS) return undefined
    if (!parsed.data || typeof parsed.data !== "object") return undefined

    const cached: HomeLatencyByServer = {}
    for (const entityId of entityIds) {
      const summaries = parsed.data[entityId]
      if (Array.isArray(summaries) && summaries.every(isTaskSummary)) cached[entityId] = summaries
    }
    return Object.keys(cached).length > 0 ? cached : undefined
  } catch {
    return undefined
  }
}

export function writeHomeLatencyCache(storage: WritableStorage | null, data: HomeLatencyByServer, savedAt = Date.now()): void {
  if (!storage || Object.keys(data).length === 0) return

  try {
    const payload: HomeLatencyCachePayload = { savedAt, data }
    storage.setItem(HOME_LATENCY_CACHE_KEY, JSON.stringify(payload))
  } catch {
    // Live data remains available when storage is disabled.
  }
}
