import { orderMonitorsByPingTasks } from "./ping-task-order"
import type { HomeLatencyByServer, HomeLatencyTaskSummary } from "./home-latency"
import type { LiteMonitor } from "@/types/lite-api"

export type AssignedPingTask = {
  id: number | string
  name?: string
  clients?: string[]
  interval?: number | null
}

function sameClientId(left: string, right: string): boolean {
  return left === right || left.toLowerCase() === right.toLowerCase()
}

export function taskAppliesToClient(task: AssignedPingTask, entityId: string): boolean {
  if (!entityId) return false
  return (task.clients || []).some((client) => sameClientId(String(client), entityId))
}

export function assignedPingTasksForClient(tasks: AssignedPingTask[], entityId: string): AssignedPingTask[] {
  return tasks.filter((task) => taskAppliesToClient(task, entityId))
}

export function emptyPingMonitor(task: AssignedPingTask, serverId: number, serverName: string): LiteMonitor {
  return {
    monitor_id: Number(task.id) || 0,
    monitor_name: task.name || `Task ${task.id}`,
    server_id: serverId,
    server_name: serverName,
    created_at: [],
    avg_delay: [],
    packet_loss: [],
    sample_count: [],
    interval: task.interval ?? null,
    lost: [],
  }
}

export function monitorsFromHomeLatency(
  summaries: HomeLatencyTaskSummary[],
  serverId: number,
  serverName: string,
): LiteMonitor[] {
  return summaries.map((summary) =>
    emptyPingMonitor({ id: summary.taskId, name: summary.taskName }, serverId, serverName),
  )
}

export function mergeAssignedPingMonitors(
  monitors: LiteMonitor[],
  tasks: AssignedPingTask[],
  entityId: string,
  serverId: number,
  serverName: string,
): LiteMonitor[] {
  const assigned = assignedPingTasksForClient(tasks, entityId)
  const merged = [...monitors]
  const seen = new Set(merged.map((monitor) => String(monitor.monitor_id)))

  for (const task of assigned) {
    const id = String(task.id)
    if (seen.has(id)) continue
    merged.push(emptyPingMonitor(task, serverId, serverName))
    seen.add(id)
  }

  return orderMonitorsByPingTasks(merged, assigned.length > 0 ? assigned : tasks)
}

export function unionPingTasksForClient(
  publicTasks: AssignedPingTask[],
  recordTasks: AssignedPingTask[],
  entityId: string,
): AssignedPingTask[] {
  const byId = new Map<string, AssignedPingTask>()

  for (const task of publicTasks) {
    byId.set(String(task.id), { ...task, clients: [...(task.clients || [])] })
  }

  for (const task of recordTasks) {
    const id = String(task.id)
    const existing = byId.get(id)
    if (!existing) {
      byId.set(id, { ...task, clients: [entityId] })
      continue
    }
    if (!taskAppliesToClient(existing, entityId)) {
      existing.clients = [...(existing.clients || []), entityId]
    }
  }

  return [...byId.values()]
}

function emptyHomeSummary(task: AssignedPingTask): HomeLatencyTaskSummary {
  return {
    taskId: String(task.id),
    taskName: task.name || `Task ${task.id}`,
    latency: null,
    packetLoss: null,
    latencyHistory: [],
    packetLossHistory: [],
    updatedAt: null,
  }
}

export function seedAssignedHomeLatency(
  existing: HomeLatencyByServer,
  tasks: AssignedPingTask[],
  entityIds: string[],
): HomeLatencyByServer {
  const result: HomeLatencyByServer = {}

  for (const entityId of entityIds) {
    const current = new Map((existing[entityId] || []).map((item) => [item.taskId, item]))
    const assigned = assignedPingTasksForClient(tasks, entityId)
    const summaries = assigned.length > 0
      ? assigned.map((task) => current.get(String(task.id)) || emptyHomeSummary(task))
      : [...current.values()]
    if (summaries.length > 0) result[entityId] = summaries
  }

  return result
}
