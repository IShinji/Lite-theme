import catalogData from "../data/fleet-catalog.json" with { type: "json" }
import linksData from "../data/fleet-links.json" with { type: "json" }

export type NodeInfo = { id: string; city: string; lat: number; lon: number; visitor?: boolean }
export type Metric = { online: boolean; net_in: number; net_out: number }
export type City = { visitor?: boolean; name: string; lat: number; lon: number; nodes: string[]; online: number; down: number; up: number; hasData: boolean }
export type GlobeLink = { from: string; to: string; kind: string; state: string }

export const fleetNodes: NodeInfo[] = catalogData
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
