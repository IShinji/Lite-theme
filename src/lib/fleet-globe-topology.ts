import { COUNTRY_CENTERS, TIMEZONE_COUNTRY } from "./globe-countries.ts"
import { type GlobeLink, type NodeInfo } from "./fleet-globe-data.ts"

export type TopoKind = "exit" | "underlay" | "relay" | "mgmt"
export type TopoState = "active" | "standby" | "down"
export type TopoLink = { from: string; to: string; kind: TopoKind; state: TopoState }
export type TopoServer = { name: string; country_code?: string }
export type Topology = { source: "remote" | "custom"; links: GlobeLink[]; extraNodes: NodeInfo[] }

export const TOPO_KINDS: TopoKind[] = ["exit", "underlay", "relay", "mgmt"]
export const KIND_LABELS: Record<TopoKind, string> = { exit: "出口", underlay: "底座", relay: "中继", mgmt: "管理" }
export const VISITOR_ID = "__visitor__"
export const VISITOR_CITY = "访客"

const KIND_ALIAS: Record<string, TopoKind> = { exit: "exit", underlay: "underlay", relay: "relay", mgmt: "mgmt", proxy: "exit", management: "mgmt" }
const STATE_ALIAS: Record<string, TopoState> = { active: "active", standby: "standby", down: "down", verified: "active", configured: "standby", unavailable: "down" }

function pick(o: Record<string, unknown>, long: string, short: string) {
  const v = o[long] ?? o[short]
  return typeof v === "string" ? v.trim() : ""
}

/** 解析 v1 格式（对象或字符串）、直接的 links 数组、紧凑键 f/t/k/s 与旧词；无法解析返回 null，合法但为空返回 []。 */
export function parseTopology(input: unknown): TopoLink[] | null {
  let data = input
  if (typeof data === "string") {
    const text = data.trim()
    if (!text) return null
    try {
      data = JSON.parse(text)
    } catch {
      return null
    }
  }
  let list: unknown
  if (Array.isArray(data)) list = data
  else if (data && typeof data === "object") {
    const o = data as Record<string, unknown>
    if (o.v !== undefined && o.v !== 1) return null
    list = o.links ?? o.l
  }
  if (!Array.isArray(list)) return null
  const out: TopoLink[] = []
  for (const item of list) {
    if (!item || typeof item !== "object") continue
    const o = item as Record<string, unknown>
    const from = pick(o, "from", "f")
    const to = pick(o, "to", "t")
    const kind = KIND_ALIAS[pick(o, "kind", "k")]
    const rawState = pick(o, "state", "s")
    const state = rawState ? STATE_ALIAS[rawState] : "standby"
    if (from && to && kind && state) out.push({ from, to, kind, state })
  }
  return out
}

export function compactTopology(links: TopoLink[]): string {
  return JSON.stringify({ v: 1, links: links.map((l) => ({ f: l.from, t: l.to, k: l.kind, s: l.state })) })
}

export function kindsPresent(links: Array<{ kind: string }>): TopoKind[] {
  const seen = new Set(links.map((l) => l.kind))
  return TOPO_KINDS.filter((k) => seen.has(k))
}

export function countryCenter(code: string | undefined | null): { lat: number; lon: number } | null {
  const c = COUNTRY_CENTERS[String(code || "").trim().toUpperCase()]
  return c ? { lat: c[0], lon: c[1] } : null
}

export function countryFromTimeZone(tz: string | undefined | null): string | null {
  return (tz && TIMEZONE_COUNTRY[tz]) || null
}

/** 端点先按 catalog 的统一名，其次按 Lite 节点自带国家码；查不到坐标的线丢弃。 */
export function resolveTopology(links: TopoLink[], catalog: NodeInfo[], servers: TopoServer[]): { links: GlobeLink[]; extraNodes: NodeInfo[] } {
  const byId = new Map(catalog.map((n) => [n.id, n]))
  const byName = new Map(servers.map((s) => [s.name, s]))
  const extra = new Map<string, NodeInfo>()
  const city = (id: string): string | null => {
    const known = byId.get(id) || extra.get(id)
    if (known) return known.city
    const code = String(byName.get(id)?.country_code || "").trim().toUpperCase()
    const pos = countryCenter(code)
    if (!pos) return null
    extra.set(id, { id, city: code, lat: pos.lat, lon: pos.lon })
    return code
  }
  const out: GlobeLink[] = []
  const used = new Set<string>()
  for (const l of links) {
    const a = city(l.from)
    const b = city(l.to)
    if (!a || !b) continue
    out.push({ from: a, to: b, kind: l.kind, state: l.state })
    used.add(l.from)
    used.add(l.to)
  }
  return { links: out, extraNodes: [...extra.values()].filter((n) => used.has(n.id)) }
}

/** 优先级：远程拓扑（有效）> GlobeLinks（有效）> null。 */
export function pickTopology(remote: unknown, custom: unknown, catalog: NodeInfo[], servers: TopoServer[]): Topology | null {
  for (const [source, raw] of [["remote", remote], ["custom", custom]] as const) {
    const parsed = parseTopology(raw)
    if (!parsed) continue
    const r = resolveTopology(parsed, catalog, servers)
    if (r.links.length > 0) return { source, links: r.links, extraNodes: r.extraNodes }
  }
  return null
}

/** 留空兜底：访客所在国家到每座城市的弧线（kind=exit，state=standby）。 */
export function visitorArcs(code: string | null | undefined, catalog: NodeInfo[]): { visitor: NodeInfo; links: GlobeLink[] } | null {
  const pos = countryCenter(code)
  if (!pos) return null
  const visitor: NodeInfo = { id: VISITOR_ID, city: VISITOR_CITY, lat: pos.lat, lon: pos.lon, visitor: true }
  const cities = [...new Set(catalog.map((n) => n.city))]
  return { visitor, links: cities.map((c) => ({ from: VISITOR_CITY, to: c, kind: "exit", state: "standby" })) }
}

/**
 * 只用普通 GET、不带凭据、不加自定义请求头。失败一律返回 null。
 * 地址可以是 https:// 完整地址（跨域时服务端需要 Access-Control-Allow-Origin），也可以是以单个 / 开头的**同源相对路径**
 * （如 /_globe/globe-xxxx.json：和 Lite 同一个域名，不需要跨域头，迁移 Lite 时地址不用改）。
 */
export async function fetchTopology(url: string, fetcher: typeof fetch = fetch, timeoutMs = 8000, base?: string): Promise<TopoLink[] | null> {
  try {
    const relative = url.startsWith("/") && !url.startsWith("//")
    const origin = base ?? (typeof location !== "undefined" ? location.origin : "https://localhost")
    const u = new URL(url, origin)
    if (!relative && !(/^https:\/\//i.test(url) && u.protocol === "https:")) return null
    const res = await fetcher(u.toString(), { credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return null
    return parseTopology(await res.json())
  } catch {
    return null
  }
}

export type HelperResult = { ok: true; links: TopoLink[]; updated?: string } | { ok: false; reason: "network" | "timeout" | "format" }

/** 点击时才调用：普通 GET、不带凭据与自定义头；失败分类为 network / timeout / format。 */
export async function fetchHelper(baseUrl: string, fetcher: typeof fetch = fetch, timeoutMs = 25000): Promise<HelperResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetcher(`${baseUrl}/topology.json`, { method: "GET", credentials: "omit", cache: "no-store", signal: controller.signal })
    if (!res.ok) return { ok: false, reason: "network" }
    let data: unknown
    try {
      data = await res.json()
    } catch (error) {
      if (controller.signal.aborted) return { ok: false, reason: "timeout" }
      return { ok: false, reason: "format" }
    }
    const links = parseTopology(data)
    if (!links) return { ok: false, reason: "format" }
    const updated = data && typeof data === "object" && !Array.isArray(data) && typeof (data as { updated?: unknown }).updated === "string" ? (data as { updated: string }).updated : undefined
    return { ok: true, links, updated }
  } catch {
    return { ok: false, reason: controller.signal.aborted ? "timeout" : "network" }
  } finally {
    clearTimeout(timer)
  }
}
