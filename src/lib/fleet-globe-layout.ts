// 地球仪的布局纯函数：初始视角、标签防重叠、紧凑速度、陆地点阵加密。
export type Rect = { x: number; y: number; w: number; h: number }
export type LabelItem = { key: string; x: number; y: number; w: number; h: number; smallW: number; smallH: number; priority: number; pinned?: boolean }
export type LabelPlacement = { key: string; x: number; y: number; w: number; h: number; mode: "full" | "name" | "hidden" }

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

/**
 * 标签防重叠：重叠的两个标签里，优先级低的沿「远离球心」方向挪开（最多 iterations 轮）；
 * 仍重叠的非固定标签依次缩成只显示城市名；还重叠就隐藏（只留圆点）。pinned（选中/悬停）永不隐藏、不缩小。
 */
export function layoutLabels(items: LabelItem[], center: { x: number; y: number }, bounds: { w: number; h: number }, iterations = 8): LabelPlacement[] {
  const state = items.map((it) => ({ it, x: it.x, y: it.y, w: it.w, h: it.h, mode: "full" as LabelPlacement["mode"] }))
  const clamp = (s: (typeof state)[number]) => {
    s.x = Math.min(Math.max(4, s.x), Math.max(4, bounds.w - s.w - 4))
    s.y = Math.min(Math.max(4, s.y), Math.max(4, bounds.h - s.h - 4))
  }
  const live = () => state.filter((s) => s.mode !== "hidden")
  const spread = () => {
    for (let round = 0; round < iterations; round++) {
      let moved = false
      const list = live()
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i], b = list[j]
          if (!overlaps(a, b)) continue
          const mover = a.it.pinned && !b.it.pinned ? b : b.it.pinned && !a.it.pinned ? a : a.it.priority < b.it.priority ? a : b
          const other = mover === a ? b : a
          let dx = mover.x + mover.w / 2 - center.x, dy = mover.y + mover.h / 2 - center.y
          if (Math.hypot(dx, dy) < 1) { dx = mover.x - other.x || 1; dy = mover.y - other.y }
          const len = Math.hypot(dx, dy) || 1
          mover.x += (dx / len) * 8
          mover.y += (dy / len) * 8
          clamp(mover)
          moved = true
        }
      }
      if (!moved) break
    }
  }
  const stuck = () => {
    const list = live()
    return list.filter((a) => !a.it.pinned && list.some((b) => b !== a && overlaps(a, b)))
  }
  state.forEach(clamp)
  spread()
  for (const mode of ["name", "hidden"] as const) {
    let bad = stuck()
    while (bad.length) {
      const victim = bad.sort((a, b) => a.it.priority - b.it.priority)[0]
      victim.mode = mode
      if (mode === "name") { victim.w = victim.it.smallW; victim.h = victim.it.smallH; clamp(victim) }
      spread()
      bad = stuck().filter((s) => s.mode === (mode === "name" ? "full" : "name"))
    }
  }
  return state.map((s) => ({ key: s.it.key, x: s.x, y: s.y, w: s.w, h: s.h, mode: s.mode }))
}

/** 紧凑速度（字节/秒）：792K、1.5M、0；不带 /s。 */
export function rateCompact(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return "0"
  const units = ["B", "K", "M", "G"]
  let n = value, i = 0
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++ }
  return `${n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)}${units[i]}`
}

/** 两点的球面角距（度）。 */
function angularDistance(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const r = Math.PI / 180
  const c = Math.sin(a.lat * r) * Math.sin(b.lat * r) + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.cos((a.lon - b.lon) * r)
  return (Math.acos(Math.min(1, Math.max(-1, c))) * 180) / Math.PI
}

/**
 * 初始视角：找「节点最密集的一片」（以某个城市为中心、半径 CLUSTER_RADIUS 度内节点数加权最多），
 * 以该片内城市的节点数加权（经度取圆周平均、纬度取平均）为中心；pitch 在 12–28 度之间略带俯视。
 * 不取全体平均：亚洲加北美的平均会落在太平洋中间，陆地点阵空空的。并列时取靠前的（城市顺序稳定）。
 */
const CLUSTER_RADIUS = 55
export function initialView(cities: Array<{ lat: number; lon: number; nodes: unknown[]; visitor?: boolean }>): { lon: number; lat: number } {
  const list = cities.filter((c) => !c.visitor).map((c) => ({ lat: c.lat, lon: c.lon, w: Math.max(1, c.nodes.length) }))
  if (!list.length) return { lon: 120, lat: 20 }
  let best = list.filter((c) => angularDistance(c, list[0]) <= CLUSTER_RADIUS)
  let bestW = best.reduce((n, c) => n + c.w, 0)
  for (const seed of list.slice(1)) {
    const group = list.filter((c) => angularDistance(c, seed) <= CLUSTER_RADIUS)
    const w = group.reduce((n, c) => n + c.w, 0)
    if (w > bestW) { best = group; bestW = w }
  }
  let sx = 0, sy = 0, sl = 0
  for (const c of best) {
    sx += Math.sin((c.lon * Math.PI) / 180) * c.w
    sy += Math.cos((c.lon * Math.PI) / 180) * c.w
    sl += c.lat * c.w
  }
  let lon = (Math.atan2(sx, sy) * 180) / Math.PI
  if (lon < 0) lon += 360
  if (lon > 180) lon -= 360
  return { lon, lat: Math.min(28, Math.max(12, (sl / bestW) * 0.6)) }
}

/** 把 2.4 度网格的陆地点加密成约 4 倍：相邻格点都是陆地时在格内补点，边缘不外扩。 */
export function densifyLand(dots: number[][], step = 2.4): number[][] {
  const cols = Math.round(360 / step)
  const ix = (lon: number) => ((Math.round((lon + 180) / step) % cols) + cols) % cols
  const iy = (lat: number) => Math.round((lat + 90) / step)
  const set = new Set(dots.map((d) => `${ix(d[0])},${iy(d[1])}`))
  const has = (i: number, j: number) => set.has(`${((i % cols) + cols) % cols},${j}`)
  const out = dots.slice()
  const half = step / 2
  for (const [lon, lat] of dots) {
    const i = ix(lon), j = iy(lat)
    const right = has(i + 1, j), up = has(i, j + 1)
    if (right) out.push([lon + half, lat])
    if (up) out.push([lon, lat + half])
    if (right && up && has(i + 1, j + 1)) out.push([lon + half, lat + half])
  }
  return out
}

/** 每个点一个稳定的 0..1 伪随机数，用来给点阵亮度分层。 */
export function dotHash(lon: number, lat: number): number {
  const v = Math.sin(lon * 12.9898 + lat * 78.233) * 43758.5453
  return v - Math.floor(v)
}
