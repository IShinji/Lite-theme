// 地球仪的配色与纯函数（调色板选择、点亮度衰减、光圈半径随时间、连线状态汇总），便于单测。
export type Palette = {
  dark: boolean
  halo: [string, string]
  platform: string
  platformLine: string
  sphere: [string, string, string, string]
  glow: string
  grid: string
  land: string
  rim: string
  edge: string
  highlight: string
  nodeCore: string
  nodeOffline: string
  nodeRing: string
  nodeGlow: string
  labelBg: string
  labelBgSelected: string
  labelBorder: string
  labelName: string
  labelSpeed: string
  additive: boolean
  gridAlpha: number
  highlightAlpha: number
  shade: string
  shadeAlpha: number
  rimAlpha: number
  ring: string
  nodeStroke: string
}

export const KIND_COLORS_DARK: Record<string, string> = { exit: "#9cefd0", mgmt: "#f5cc79", underlay: "#8ecbff", relay: "#d3b8ff" }
export const KIND_COLORS_LIGHT: Record<string, string> = { exit: "#0c9a6c", mgmt: "#d08a0e", underlay: "#2a86d0", relay: "#8059d0" }

/** 深色背景沿用原色；浅色球面上换成更深更饱和的同色系，保证弧线清晰。 */
export function kindColors(dark: boolean): Record<string, string> {
  return dark ? KIND_COLORS_DARK : KIND_COLORS_LIGHT
}

const LIGHT: Palette = {
  dark: false,
  halo: ["rgba(90,210,170,.22)", "rgba(90,210,170,0)"],
  platform: "rgba(110,215,175,.18)",
  platformLine: "rgba(12,153,109,.20)",
  sphere: ["#f7fffb", "#d3f4e5", "#a2e2c8", "#6ccaa8"],
  glow: "rgba(40,180,135,.30)",
  grid: "14,140,104",
  land: "14,150,108",
  rim: "255,255,255",
  edge: "rgba(24,160,118,.55)",
  highlight: "255,255,255",
  nodeCore: "#0d9a6e",
  nodeOffline: "#8aa59a",
  nodeRing: "255,255,255",
  nodeGlow: "20,190,140",
  labelBg: "rgba(255,255,255,.74)",
  labelBgSelected: "rgba(255,255,255,.94)",
  labelBorder: "rgba(20,140,105,.32)",
  labelName: "#0a4a38",
  labelSpeed: "#2c7a62",
  additive: false,
  gridAlpha: 0.2,
  highlightAlpha: 0.5,
  shade: "0,100,75",
  shadeAlpha: 0.16,
  rimAlpha: 0.75,
  ring: "40,185,140",
  nodeStroke: "rgba(255,255,255,.95)",
}

const DARK: Palette = {
  dark: true,
  halo: ["rgba(30,215,165,.26)", "rgba(30,215,165,0)"],
  platform: "rgba(40,200,160,.10)",
  platformLine: "rgba(80,230,190,.20)",
  sphere: ["#14806b", "#0b6354", "#06453d", "#032b27"],
  glow: "rgba(30,215,165,.32)",
  grid: "150,255,215",
  land: "175,255,228",
  rim: "125,255,210",
  edge: "rgba(140,255,215,.5)",
  highlight: "200,255,235",
  nodeCore: "#e8fff5",
  nodeOffline: "#7f948c",
  nodeRing: "150,255,215",
  nodeGlow: "90,255,200",
  labelBg: "rgba(3,32,28,.78)",
  labelBgSelected: "rgba(3,40,34,.94)",
  labelBorder: "rgba(140,255,215,.28)",
  labelName: "#ffffff",
  labelSpeed: "#a5e6cc",
  additive: true,
  gridAlpha: 0.11,
  highlightAlpha: 0.14,
  shade: "0,20,16",
  shadeAlpha: 0.4,
  rimAlpha: 0.5,
  ring: "110,255,215",
  nodeStroke: "rgba(0,40,32,.6)",
}

export function globePalette(dark: boolean): Palette {
  return dark ? DARK : LIGHT
}

export function rgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return `rgba(255,255,255,${alpha})`
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0)

/** 陆地点的亮度：z 为朝向观察者的深度（球心 1，边缘 0），越靠边越淡。 */
export function dotAlpha(z: number): number {
  return 0.2 + 0.75 * Math.pow(clamp01(z), 0.8)
}

export function dotRadius(z: number): number {
  return 0.42 + clamp01(z) * 0.5
}

export const RING_PERIOD_MS = 2600
export const RING_COUNT = 2

/** 节点脉冲光圈：从节点向外扩散并渐隐；index 错开半个周期。 */
export function ringState(now: number, index: number, period = RING_PERIOD_MS): { radius: number; alpha: number } {
  const phase = (((now / period + index / RING_COUNT) % 1) + 1) % 1
  return { radius: 6 + phase * 18, alpha: 0.6 * Math.pow(1 - phase, 2) }
}

export type CityLinkState = "active" | "standby" | "down"

/** 每座城市的连线状态：任一条 active 为 active，否则有 standby 为 standby，只有 down 为 down；没有连线的城市不在表里。 */
export function cityStates(links: Array<{ from: string; to: string; state: string }>): Map<string, CityLinkState> {
  const rank: Record<string, number> = { down: 0, standby: 1, active: 2 }
  const out = new Map<string, CityLinkState>()
  for (const l of links) {
    const s = (l.state in rank ? l.state : "standby") as CityLinkState
    for (const c of [l.from, l.to]) {
      const prev = out.get(c)
      if (!prev || rank[s] > rank[prev]) out.set(c, s)
    }
  }
  return out
}

/** 静态层（球体、经纬网、陆地点阵）缓存键：镜头变化小于 0.1 度视为同一帧。 */
export function staticLayerKey(cam: { lon: number; lat: number; zoom: number }, w: number, h: number, dark: boolean, landCount: number): string {
  return [Math.round(cam.lon * 10), Math.round(cam.lat * 10), Math.round(cam.zoom * 100), w, h, dark ? 1 : 0, landCount].join("|")
}
