import { SharedClient } from "@/hooks/use-rpc2"
import { MonitorResponse, ServerGroupResponse, SettingResponse } from "@/types/lite-api"

import { historyMaxPoints, probeHistoryMaxPoints } from "./history-range"
import { HomeLatencyByServer, mapPingStatsToHomeLatency } from "./home-latency"
import { mergeAssignedPingMonitors, seedAssignedHomeLatency, unionPingTasksForClient } from "./ping-display"
import { orderMonitorsByPingTasks } from "./ping-task-order"
import { mergeResourceSeries, type ResourceHistoryPoint, type ResourceSample, type ResourceTotals } from "./resource-history"
import { getLiteNodes, uuidToNumber } from "./utils"

export type { ResourceHistoryPoint } from "./resource-history"

const PING_LATENCY_METRIC = "ping.latency_ms"
const PING_LOSS_METRIC = "ping.loss"

interface LiteMetricPoint {
  time?: string
  value?: number | null
  count?: number
  tag?: Record<string, string>
  tags?: Record<string, string>
  labels?: Record<string, string>
}

interface LiteMetricSeries {
  metric_key?: string
  entity_id?: string
  tag?: Record<string, string>
  tags?: Record<string, string>
  labels?: Record<string, string>
  points?: LiteMetricPoint[]
}

interface LitePingTask {
  id: number | string
  name?: string
  clients?: string[]
  interval?: number | null
}

interface LiteMetricResponse {
  series?: LiteMetricSeries[]
}

interface PingLossSample {
  ratio: number
  count: number
}

function firstNonEmptyTags(...maps: Array<Record<string, string> | undefined>): Record<string, string> {
  for (const map of maps) {
    if (map && Object.keys(map).length > 0) return map
  }
  return {}
}

function metricSeriesTags(series: LiteMetricSeries): Record<string, string> {
  const point = series.points?.find((item) => firstNonEmptyTags(item.tags, item.tag, item.labels))
  return firstNonEmptyTags(series.tags, series.tag, series.labels, point?.tags, point?.tag, point?.labels)
}

function metricTaskId(series: LiteMetricSeries): string {
  return String(metricSeriesTags(series).task_id || "")
}

function metricSeriesKey(series: LiteMetricSeries): string {
  return `${series.entity_id || ""}\u0000${metricTaskId(series)}`
}

function metricPointCount(point: LiteMetricPoint): number {
  const count = Number(point.count)
  return Number.isFinite(count) && count > 0 ? count : 1
}

function metricPointTime(point: LiteMetricPoint): number | null {
  const time = Date.parse(point.time || "")
  return Number.isFinite(time) ? time : null
}

function clampLossRatio(value: unknown): number {
  const ratio = Number(value)
  return Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0
}

function buildPingLossLookup(seriesList: LiteMetricSeries[]): Map<string, Map<number, PingLossSample>> {
  const lookup = new Map<string, Map<number, PingLossSample>>()

  for (const series of seriesList) {
    if (series.metric_key !== PING_LOSS_METRIC || !metricTaskId(series)) continue
    const points = new Map<number, PingLossSample>()
    for (const point of series.points || []) {
      const time = metricPointTime(point)
      if (time === null || point.value === null || point.value === undefined) continue
      points.set(time, { ratio: clampLossRatio(point.value), count: metricPointCount(point) })
    }
    lookup.set(metricSeriesKey(series), points)
  }

  return lookup
}

function latencyWithoutLoss(value: unknown, count: number, loss?: PingLossSample): number | null {
  const average = Number(value)
  if (!Number.isFinite(average)) return null
  if (!loss) return average >= 0 ? average : null

  const lost = count * loss.ratio
  const valid = count - lost
  if (valid <= 0) return null

  const latency = (average * count + lost) / valid
  return Number.isFinite(latency) && latency >= 0 ? latency : null
}

let pingTaskCache: { savedAt: number; tasks: LitePingTask[] } | null = null
const PING_TASK_TTL_MS = 60_000

function asPingTaskList(value: unknown): LitePingTask[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is LitePingTask => !!item && typeof item === "object" && "id" in item)
  }
  if (!value || typeof value !== "object") return []
  const record = value as Record<string, unknown>
  for (const key of ["data", "tasks", "result"]) {
    if (Array.isArray(record[key])) return asPingTaskList(record[key])
  }
  return []
}

async function fetchPublicPingTasks(): Promise<LitePingTask[]> {
  if (pingTaskCache && Date.now() - pingTaskCache.savedAt < PING_TASK_TTL_MS) {
    return pingTaskCache.tasks
  }

  try {
    const taskResult = await SharedClient().call<undefined, unknown>("public:getPublicPingTasks", undefined, { timeout: 15000 })
    const tasks = asPingTaskList(taskResult)
    pingTaskCache = { savedAt: Date.now(), tasks }
    return tasks
  } catch {
    return pingTaskCache?.tasks || []
  }
}

async function fetchPingMetricSeries(
  params: Record<string, unknown>,
  maxPoints: number,
): Promise<{ series: LiteMetricSeries[]; tasks: LitePingTask[] }> {
  const client = SharedClient()
  const [result, tasks] = await Promise.all([
    client.call<Record<string, unknown>, LiteMetricResponse>(
      "public:queryMetrics",
      {
        metric_keys: [PING_LATENCY_METRIC, PING_LOSS_METRIC],
        ...params,
        downsample: true,
        max_points: maxPoints,
        aggregation: "avg",
        fill_empty: false,
      },
      { timeout: 20000 },
    ),
    fetchPublicPingTasks(),
  ])

  const series = Array.isArray(result?.series) ? result.series.filter((item) => item.entity_id) : []
  return { series, tasks }
}

function monitorDataFromMetricSeries(
  seriesList: LiteMetricSeries[],
  tasks: LitePingTask[],
  serverId: number,
  serverName: string,
): MonitorResponse["data"] {
  const taskNames = new Map(tasks.map((task) => [String(task.id), task.name || `Task ${task.id}`]))
  const taskIntervals = new Map(tasks.map((task) => [String(task.id), task.interval]))
  const lossLookup = buildPingLossLookup(seriesList)
  const monitors: MonitorResponse["data"] = []

  for (const series of seriesList) {
    const taskId = metricTaskId(series)
    if (series.metric_key !== PING_LATENCY_METRIC || !taskId) continue

    const monitorId = Number(taskId)
    const monitor = {
      monitor_id: Number.isFinite(monitorId) ? monitorId : 0,
      monitor_name: taskNames.get(taskId) || `Task ${taskId}`,
      server_id: serverId,
      server_name: serverName,
      created_at: [] as number[],
      avg_delay: [] as Array<number | null>,
      packet_loss: [] as number[],
      sample_count: [] as number[],
      interval: taskIntervals.get(taskId) ?? null,
      lost: [] as boolean[],
    }
    const lossPoints = lossLookup.get(metricSeriesKey(series))
    const points = [...(series.points || [])].sort((a, b) => (metricPointTime(a) || 0) - (metricPointTime(b) || 0))

    for (const point of points) {
      const time = metricPointTime(point)
      if (time === null) continue
      const count = metricPointCount(point)
      const loss = lossPoints?.get(time)
      const delay = point.value === null || point.value === undefined
        ? null
        : latencyWithoutLoss(point.value, count, loss)
      monitor.created_at.push(time)
      monitor.avg_delay.push(delay)
      const lossRatio = loss?.ratio ?? (Number(point.value) < 0 ? 1 : 0)
      monitor.packet_loss.push(lossRatio * 100)
      monitor.lost.push(lossRatio > 0)
      monitor.sample_count.push(loss?.count ?? count)
    }

    if (monitor.created_at.length > 0 || taskNames.has(taskId)) monitors.push(monitor)
  }

  return orderMonitorsByPingTasks(monitors, tasks)
}

function parseOrderedList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean)
  if (typeof value !== "string" || !value.trim()) return []

  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) return parsed.map(String).map((item) => item.trim()).filter(Boolean)
  } catch {
    // Fall through to delimiter parsing.
  }

  return value.split(/[\n,，;；|]/).map((item) => item.trim()).filter(Boolean)
}

function sortGroupsByThemeOrder(groups: string[]): string[] {
  const settings = typeof window === "undefined" ? {} : (window as unknown as Record<string, unknown>)
  const order = parseOrderedList(settings.GroupOrder)
  const orderMap = new Map(order.map((name, index) => [name, index]))

  return [...groups].sort((a, b) => {
    const first = orderMap.get(a) ?? Number.MAX_SAFE_INTEGER
    const second = orderMap.get(b) ?? Number.MAX_SAFE_INTEGER
    return first === second ? a.localeCompare(b) : first - second
  })
}

export async function fetchServerGroup(): Promise<ServerGroupResponse> {
  const nodes: Record<string, any> = await getLiteNodes()
  if (nodes?.error) throw new Error(nodes.error)

  const groups = sortGroupsByThemeOrder(
    [...new Set(Object.values(nodes).map((node) => String(node?.group || "")).filter(Boolean))],
  )
  const now = new Date().toISOString()

  return {
    success: true,
    data: groups.map((group, index) => ({
      group: { id: index, created_at: now, updated_at: now, name: group },
      servers: Object.entries(nodes)
        .filter(([, node]) => node?.group === group)
        .map(([uuid]) => uuidToNumber(uuid)),
    })),
  }
}

export async function fetchMonitor(serverId: number, hours = 24): Promise<MonitorResponse> {
  const nodes: Record<string, any> = await getLiteNodes()
  if (nodes?.error) throw new Error(nodes.error)

  const uuid = Object.keys(nodes).find((id) => uuidToNumber(id) === serverId)
  if (!uuid) return { success: true, data: [] }

  const serverName = nodes[uuid]?.name || String(serverId)
  const maxPoints = probeHistoryMaxPoints(hours)
  const metricData = await fetchPingMetricSeries({ entity_id: uuid, hours }, maxPoints)
  let tasks = unionPingTasksForClient(metricData.tasks, [], uuid)
  let monitors = monitorDataFromMetricSeries(metricData.series, tasks, serverId, serverName)
  if (!monitors.some((monitor) => monitor.created_at.length > 0)) {
    const recordData = await fetchPingRecords(uuid, hours)
    tasks = unionPingTasksForClient(metricData.tasks, recordData.tasks, uuid)
    if (recordData.records.length > 0) {
      monitors = monitorsFromPingRecords(recordData.records, tasks, serverId, serverName)
    }
  }

  return {
    success: true,
    data: mergeAssignedPingMonitors(monitors, tasks, uuid, serverId, serverName),
  }
}

interface PingRecordItem {
  time?: string
  value?: number
  client?: string
  task_id?: number
}

interface PingRecordsResponse {
  records?: PingRecordItem[]
  tasks?: LitePingTask[]
}

async function fetchPingRecords(uuid: string, hours: number): Promise<{ records: PingRecordItem[]; tasks: LitePingTask[] }> {
  try {
    const result = await SharedClient().call<Record<string, unknown>, PingRecordsResponse>(
      "public:getPingRecords",
      { uuid, hours: String(hours) },
      { timeout: 20000 },
    )
    return {
      records: Array.isArray(result?.records) ? result.records : [],
      tasks: asPingTaskList(result?.tasks),
    }
  } catch {
    return { records: [], tasks: [] }
  }
}

function monitorsFromPingRecords(
  records: PingRecordItem[],
  tasks: LitePingTask[],
  serverId: number,
  serverName: string,
): MonitorResponse["data"] {
  const taskNames = new Map(tasks.map((task) => [String(task.id), task.name || `Task ${task.id}`]))
  const taskIntervals = new Map(tasks.map((task) => [String(task.id), task.interval]))
  const grouped = new Map<string, { created_at: number[]; avg_delay: Array<number | null>; lost: boolean[] }>()

  for (const record of records) {
    const taskId = String(record.task_id || "")
    if (!taskId) continue
    const time = Date.parse(record.time || "")
    if (!Number.isFinite(time)) continue
    const group = grouped.get(taskId) || { created_at: [], avg_delay: [], lost: [] }
    const value = Number(record.value)
    group.created_at.push(time)
    group.avg_delay.push(Number.isFinite(value) && value >= 0 ? value : null)
    group.lost.push(Number.isFinite(value) && value < 0)
    grouped.set(taskId, group)
  }

  const monitors: MonitorResponse["data"] = []
  for (const [taskId, group] of grouped) {
    const monitorId = Number(taskId)
    monitors.push({
      monitor_id: Number.isFinite(monitorId) ? monitorId : 0,
      monitor_name: taskNames.get(taskId) || `Task ${taskId}`,
      server_id: serverId,
      server_name: serverName,
      created_at: group.created_at,
      avg_delay: group.avg_delay,
      interval: taskIntervals.get(taskId) ?? null,
      lost: group.lost,
    })
  }
  return orderMonitorsByPingTasks(monitors, tasks)
}

interface PublicPingMetricStat {
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

interface PublicPingMetricStatsResponse {
  stats?: PublicPingMetricStat[]
}

export async function fetchHomeLatency(entityIds: string[]): Promise<HomeLatencyByServer> {
  const uniqueEntityIds = [...new Set(entityIds.filter(Boolean))]
  if (uniqueEntityIds.length === 0) return {}

  const [statsResult, tasks] = await Promise.all([
    SharedClient().call<Record<string, unknown>, PublicPingMetricStatsResponse>(
      "public:getPingMetricStats",
      {
        entity_ids: uniqueEntityIds,
        hours: 1,
        max_points: 12,
      },
      { timeout: 15000 },
    ),
    fetchPublicPingTasks(),
  ])

  return seedAssignedHomeLatency(mapPingStatsToHomeLatency(statsResult?.stats || [], tasks), tasks, uniqueEntityIds)
}

const CPU_USAGE_METRIC = "cpu.usage"
const MEMORY_USED_METRIC = "memory.used"
const SWAP_USED_METRIC = "swap.used"
const DISK_USED_METRIC = "disk.used"
const TCP_CONNECTIONS_METRIC = "connections.tcp"
const UDP_CONNECTIONS_METRIC = "connections.udp"

function metricSamples(seriesList: LiteMetricSeries[], metricKey: string): ResourceSample[] {
  const samples: ResourceSample[] = []
  for (const series of seriesList) {
    if (series.metric_key !== metricKey) continue
    for (const point of series.points || []) {
      const time = metricPointTime(point)
      const value = Number(point.value)
      if (time === null || !Number.isFinite(value)) continue
      samples.push({ time, value })
    }
  }
  return samples
}

interface LoadRecordItem {
  time?: string
  cpu?: number
  ram?: number
  ram_total?: number
  swap?: number
  swap_total?: number
  disk?: number
  disk_total?: number
  connections?: number
  connections_tcp?: number
  connections_udp?: number
}

function recordSamples(
  records: LoadRecordItem[],
  field: "cpu" | "ram" | "swap" | "disk" | "connections_tcp" | "connections_udp",
): ResourceSample[] {
  const samples: ResourceSample[] = []
  for (const record of records) {
    const time = Date.parse(record.time || "")
    const value = Number(record[field])
    if (!Number.isFinite(time) || !Number.isFinite(value)) continue
    samples.push({ time, value })
  }
  return samples
}

function recordTcpSamples(records: LoadRecordItem[]): ResourceSample[] {
  const explicit = recordSamples(records, "connections_tcp")
  if (explicit.length > 0) return explicit
  const samples: ResourceSample[] = []
  for (const record of records) {
    const time = Date.parse(record.time || "")
    const total = Number(record.connections)
    const udp = Number(record.connections_udp)
    if (!Number.isFinite(time) || !Number.isFinite(total)) continue
    samples.push({ time, value: Number.isFinite(udp) ? Math.max(0, total - udp) : total })
  }
  return samples
}

export async function fetchResourceHistory(serverId: number, hours: number, totals: ResourceTotals): Promise<ResourceHistoryPoint[]> {
  const nodes: Record<string, any> = await getLiteNodes()
  if (nodes?.error) throw new Error(nodes.error)

  const uuid = Object.keys(nodes).find((id) => uuidToNumber(id) === serverId)
  if (!uuid) return []

  const maxPoints = historyMaxPoints(hours)
  const metricResult = await SharedClient().call<Record<string, unknown>, LiteMetricResponse>(
    "public:queryMetrics",
    {
      metric_keys: [
        CPU_USAGE_METRIC,
        MEMORY_USED_METRIC,
        SWAP_USED_METRIC,
        DISK_USED_METRIC,
        TCP_CONNECTIONS_METRIC,
        UDP_CONNECTIONS_METRIC,
      ],
      entity_id: uuid,
      hours,
      downsample: true,
      max_points: maxPoints,
      aggregation: "avg",
      fill_empty: false,
    },
    { timeout: 20000 },
  ).catch(() => ({ series: [] as LiteMetricSeries[] }))

  const series = Array.isArray(metricResult?.series) ? metricResult.series : []
  let points = mergeResourceSeries(
    metricSamples(series, CPU_USAGE_METRIC),
    metricSamples(series, MEMORY_USED_METRIC),
    metricSamples(series, DISK_USED_METRIC),
    totals,
    {
      swapUsed: metricSamples(series, SWAP_USED_METRIC),
      tcp: metricSamples(series, TCP_CONNECTIONS_METRIC),
      udp: metricSamples(series, UDP_CONNECTIONS_METRIC),
    },
  )

  if (points.length > 0) return points

  const recordResult = await SharedClient().call<Record<string, unknown>, { records?: LoadRecordItem[] }>(
    "public:getRecordsByUUID",
    { uuid, hours: String(hours), load_type: "all" },
    { timeout: 20000 },
  ).catch(() => ({ records: [] as LoadRecordItem[] }))

  const records = Array.isArray(recordResult?.records) ? recordResult.records : []
  const memTotal = Number(records.find((record) => Number(record.ram_total) > 0)?.ram_total) || totals.memTotal
  const diskTotal = Number(records.find((record) => Number(record.disk_total) > 0)?.disk_total) || totals.diskTotal
  const swapTotal = Number(records.find((record) => Number(record.swap_total) > 0)?.swap_total) || totals.swapTotal
  return mergeResourceSeries(
    recordSamples(records, "cpu"),
    recordSamples(records, "ram"),
    recordSamples(records, "disk"),
    { memTotal, diskTotal, swapTotal },
    {
      swapUsed: recordSamples(records, "swap"),
      tcp: recordTcpSamples(records),
      udp: recordSamples(records, "connections_udp"),
    },
  )
}

export type ThemeAccount = {
  logged_in: boolean
  username: string
  avatar_url: string
}

export async function fetchAccount(): Promise<ThemeAccount> {
  try {
    const response = await fetch("/api/me", { credentials: "include", cache: "no-store" })
    if (!response.ok) return { logged_in: false, username: "", avatar_url: "" }
    const json = await response.json()
    const data = json?.data && typeof json.data === "object" ? json.data : json
    return {
      logged_in: data?.logged_in === true,
      username: typeof data?.username === "string" ? data.username : "",
      avatar_url: typeof data?.avatar_url === "string" ? data.avatar_url.trim() : "",
    }
  } catch {
    return { logged_in: false, username: "", avatar_url: "" }
  }
}

export async function fetchSetting(): Promise<SettingResponse> {
  const response = await fetch("/api/public", { credentials: "include", cache: "no-store" })
  if (response.status === 401) {
    return {
      success: true,
      data: {
        config: {
          debug: false,
          language: "zh-CN",
          site_name: "Lite",
          site_desc: "",
          user_template: "",
          admin_template: "",
          custom_code: "",
        },
        private_site: true,
        version: "unknown",
      },
    }
  }
  if (!response.ok) throw new Error(`Failed to fetch public settings: ${response.status}`)

  const json = await response.json()
  const publicData = json?.data || json
  if (json?.status === "error" || publicData?.error) {
    throw new Error(json?.message || publicData?.error || "Failed to fetch public settings")
  }

  let privateSite = publicData.private_site === true
  if (privateSite) {
    try {
      const currentUser = await fetchAccount()
      if (currentUser.logged_in) privateSite = false
    } catch {
      // Keep the public page locked when the session check is unavailable.
    }
  }

  if (publicData.theme_settings && typeof publicData.theme_settings === "object") {
    const target = window as unknown as Record<string, unknown>
    target.__themeSettings = { ...publicData.theme_settings }
    for (const [key, value] of Object.entries(publicData.theme_settings)) target[key] = value
  }

  return {
    success: true,
    data: {
      config: {
        debug: false,
        language: "zh-CN",
        site_name: publicData.sitename || "Lite",
        site_desc: publicData.description || "",
        user_template: "",
        admin_template: "",
        custom_code: "",
      },
      private_site: privateSite,
      version: "unknown",
    },
  }
}
