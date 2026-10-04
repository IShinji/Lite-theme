import { HOME_LATENCY_CARD_LIMIT, type HomeLatencyTaskSummary } from "./home-latency.ts"

export function normalizeHomeProbeTaskIds(value: unknown): number[] {
  const list = Array.isArray(value) ? value : []
  const ids: number[] = []
  const seen = new Set<number>()
  for (const item of list) {
    const id = typeof item === "number" ? item : Number(item)
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
    if (ids.length >= HOME_LATENCY_CARD_LIMIT) break
  }
  return ids
}

export function parseHomeProbeTaskOverrides(value: unknown): Record<string, number[]> {
  let source = value
  if (typeof source === "string") {
    try {
      source = JSON.parse(source)
    } catch {
      return {}
    }
  }
  if (!source || typeof source !== "object" || Array.isArray(source)) return {}

  const result: Record<string, number[]> = {}
  for (const [key, ids] of Object.entries(source as Record<string, unknown>)) {
    const uuid = String(key || "").trim()
    if (!uuid) continue
    const normalized = normalizeHomeProbeTaskIds(ids)
    if (normalized.length > 0) result[uuid] = normalized
  }
  return result
}

export function homeProbeOverrideIds(overrides: Record<string, number[]>, entityId: string): number[] {
  if (!entityId) return []
  if (overrides[entityId]) return overrides[entityId]
  const lower = entityId.toLowerCase()
  for (const [key, ids] of Object.entries(overrides)) {
    if (key.toLowerCase() === lower) return ids
  }
  return []
}

export function applyHomeProbeTaskOrder(
  summaries: HomeLatencyTaskSummary[] | undefined,
  selectedIds: number[],
): HomeLatencyTaskSummary[] {
  const list = summaries || []
  if (selectedIds.length === 0 || list.length === 0) return list
  const byId = new Map(list.map((item) => [String(item.taskId), item]))
  const ordered: HomeLatencyTaskSummary[] = []
  for (const id of selectedIds) {
    const item = byId.get(String(id))
    if (item) ordered.push(item)
  }
  return ordered.length > 0 ? ordered : list
}
