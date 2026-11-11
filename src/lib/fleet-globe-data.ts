import linksData from "../data/fleet-links.json" with { type: "json" }

export type NodeInfo = { id: string; city: string; lat: number; lon: number; visitor?: boolean }
export type Metric = { online: boolean; net_in: number; net_out: number }
export type City = { visitor?: boolean; flag?: string; name: string; lat: number; lon: number; nodes: string[]; online: number; down: number; up: number; hasData: boolean }
export type GlobeLink = { from: string; to: string; kind: string; state: string }

export const fleetLinks = linksData

/** 与原版 lib/fleet.ts 的 rate 一致（字节/秒）。 */
export function rate(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—"
  const units = ["B/s", "KB/s", "MB/s", "GB/s"]
  let i = 0
  let n = Math.max(0, value)
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${units[i]}`
}

/** 按统一名（catalog id === Lite 节点名）匹配采样；没匹配到的为 null，即「无采样」。 */
export function matchMetrics(nodes: NodeInfo[], samples: Array<{ name: string } & Metric>): Record<string, Metric | null> {
  const byName = new Map(samples.map((s) => [s.name, s]))
  const out: Record<string, Metric | null> = {}
  for (const n of nodes) {
    const s = byName.get(n.id)
    out[n.id] = s ? { online: s.online === true, net_in: Math.max(0, s.net_in || 0), net_out: Math.max(0, s.net_out || 0) } : null
  }
  return out
}

/** 统一名以两位大写国家码开头（HK-、JP-…）→ 国旗 emoji；m1-physical 等不规范的 id 返回空串。 */
export function flagOfId(id: string): string {
  const m = /^([A-Z]{2})-/.exec(id)
  if (!m) return ""
  return String.fromCodePoint(...[...m[1]].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65))
}

/** 与原版 fleet-dashboard 的 cities useMemo 一致：同城汇总，只累加在线节点的速度。 */
export function buildCities(nodes: NodeInfo[], metrics: Record<string, Metric | null>): City[] {
  const groups = new Map<string, City>()
  for (const n of nodes) {
    let c = groups.get(n.city)
    if (!c) {
      c = { visitor: n.visitor, name: n.city, lat: n.lat, lon: n.lon, nodes: [], online: 0, down: 0, up: 0, hasData: false }
      groups.set(n.city, c)
    }
    c.nodes.push(n.id)
    if (!c.flag) c.flag = flagOfId(n.id) || undefined
    const m = metrics[n.id]
    if (m) {
      c.hasData = true
      if (m.online) {
        c.online++
        c.down += m.net_in
        c.up += m.net_out
      }
    }
  }
  return [...groups.values()]
}

/** 离线隐藏的防抖：记录每个节点「连续离线」的起点；在线（或不在 Lite 里）立刻清掉。返回新表。 */
export function trackOfflineSince(prev: ReadonlyMap<string, number>, offlineNow: ReadonlySet<string>, ts: number): Map<string, number> {
  const out = new Map<string, number>()
  for (const id of offlineNow) out.set(id, prev.get(id) ?? ts)
  return out
}

export const OFFLINE_HIDE_MS = 10_000

/** 连续离线满 graceMs 才算「已隐藏」；恢复在线（不在 since 表里）立刻显示。 */
export function hiddenOffline(since: ReadonlyMap<string, number>, ts: number, graceMs = OFFLINE_HIDE_MS): Set<string> {
  const out = new Set<string>()
  for (const [id, t] of since) if (ts - t >= graceMs) out.add(id)
  return out
}

/** 城市里所有节点都已隐藏 → 整座城市不画（含标签）；只要还有一台没隐藏就保留，节点数只算未隐藏的。没有节点的城市（如访客点）不动。 */
export function dropHiddenCities(cities: City[], hidden: ReadonlySet<string>): City[] {
  if (hidden.size === 0) return cities
  const out: City[] = []
  for (const c of cities) {
    if (c.nodes.length === 0) { out.push(c); continue }
    const left = c.nodes.filter((id) => !hidden.has(id))
    if (left.length === 0) continue
    out.push(left.length === c.nodes.length ? c : { ...c, nodes: left })
  }
  return out
}
