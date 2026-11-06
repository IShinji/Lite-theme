// 平面地图（等距圆柱投影）的纯函数：固定的世界图（左右不循环）、镜头约束与缩放、区域预设、投影、连线弧线、视图偏好存取。
export type FlatCamera = { lon: number; lat: number; zoom: number }
export type FlatView = "globe" | "flat"
export type LonLatBox = { lon: [number, number]; lat: [number, number] }
export type FlatRegion = LonLatBox & { key: string; label: string }

/** 世界范围：北纬 84 到南纬 58。南极洲没有节点，裁掉后同样宽度下图更大。 */
export const WORLD_LAT_TOP = 84
export const WORLD_LAT_BOTTOM = -58
const LAT_SPAN = WORLD_LAT_TOP - WORLD_LAT_BOTTOM
const LAT_MID = (WORLD_LAT_TOP + WORLD_LAT_BOTTOM) / 2

/** 全球视图：整张世界图刚好放进画面。 */
export const FLAT_HOME: FlatCamera = { lon: 0, lat: LAT_MID, zoom: 1 }
export const FLAT_ZOOM_MIN = 1
export const FLAT_ZOOM_MAX = 6
export const FLAT_VIEW_KEY = "lite-home-map-view"

/** 每度对应的像素：整个世界（360 度 × 裁剪后的纬度）刚好放进容器（留 2% 边距），再乘缩放。 */
export function flatScale(width: number, height: number, zoom: number): number {
  return Math.min(width / 360, height / LAT_SPAN) * 0.98 * zoom
}

/** 经纬度 → 画布坐标：普通等距圆柱投影，与印刷世界地图一致，左右边缘固定在 ±180 度，不循环。 */
export function flatProject(lat: number, lon: number, cam: FlatCamera, width: number, height: number) {
  const s = flatScale(width, height, cam.zoom)
  return { x: width / 2 + (lon - cam.lon) * s, y: height / 2 - (lat - cam.lat) * s }
}

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return FLAT_ZOOM_MIN
  return Math.min(FLAT_ZOOM_MAX, Math.max(FLAT_ZOOM_MIN, zoom))
}

/**
 * 把镜头约束在世界范围内：画面永远不会越过 ±180 度或裁剪后的南北边缘。
 * 缩放 1 时整张图都在画面里，经纬度固定居中；放大后才能平移。
 */
export function clampCamera(cam: FlatCamera, width: number, height: number): FlatCamera {
  const zoom = clampZoom(cam.zoom)
  const s = flatScale(width, height, zoom)
  const halfLon = width / 2 / s
  const halfLat = height / 2 / s
  const lon = halfLon >= 180 || !Number.isFinite(cam.lon) ? 0 : Math.min(180 - halfLon, Math.max(-180 + halfLon, cam.lon))
  const lat =
    halfLat >= LAT_SPAN / 2 || !Number.isFinite(cam.lat) ? LAT_MID : Math.min(WORLD_LAT_TOP - halfLat, Math.max(WORLD_LAT_BOTTOM + halfLat, cam.lat))
  return { lon, lat, zoom }
}

/** 以画布上的 (px, py) 为不动点缩放 factor 倍：鼠标指着的那个地方缩放前后在同一个位置。 */
export function zoomAt(cam: FlatCamera, factor: number, px: number, py: number, width: number, height: number): FlatCamera {
  const zoom = clampZoom(cam.zoom * factor)
  const before = flatScale(width, height, cam.zoom)
  const after = flatScale(width, height, zoom)
  const dx = px - width / 2
  const dy = py - height / 2
  return clampCamera({ lon: cam.lon + dx / before - dx / after, lat: cam.lat - dy / before + dy / after, zoom }, width, height)
}

/** 让一个经纬度范围刚好放进画面（四周留 pad 比例的边）。 */
export function fitBounds(box: LonLatBox, width: number, height: number, pad = 0.1): FlatCamera {
  const lonSpan = Math.max(1, box.lon[1] - box.lon[0])
  const latSpan = Math.max(1, box.lat[1] - box.lat[0])
  const need = Math.min((width * (1 - 2 * pad)) / lonSpan, (height * (1 - 2 * pad)) / latSpan)
  const zoom = clampZoom(need / flatScale(width, height, 1))
  return clampCamera({ lon: (box.lon[0] + box.lon[1]) / 2, lat: (box.lat[0] + box.lat[1]) / 2, zoom }, width, height)
}

/** 区域预设：范围互不重叠（香港归东亚、不归东南亚），按钮只显示里面有节点的区域。 */
export const FLAT_REGIONS: FlatRegion[] = [
  { key: "na", label: "北美", lon: [-170, -50], lat: [14, 72] },
  { key: "sa", label: "南美", lon: [-82, -34], lat: [-56, 13] },
  { key: "eu", label: "欧洲", lon: [-12, 40], lat: [35, 62] },
  { key: "mea", label: "中东非洲", lon: [-18, 62], lat: [-35, 34] },
  { key: "ea", label: "东亚", lon: [98, 150], lat: [20, 50] },
  { key: "sea", label: "东南亚", lon: [92, 128], lat: [-10, 19.9] },
  { key: "oc", label: "大洋洲", lon: [110, 180], lat: [-48, -10.5] },
]

export function regionsWithCities(cities: Array<{ lat: number; lon: number; visitor?: boolean }>): FlatRegion[] {
  const real = cities.filter((c) => !c.visitor)
  return FLAT_REGIONS.filter((r) => real.some((c) => c.lon >= r.lon[0] && c.lon <= r.lon[1] && c.lat >= r.lat[0] && c.lat <= r.lat[1]))
}

/** 静态层（网格与陆地点阵）缓存键：镜头变化小于 0.01 度视为同一帧。 */
export function flatLayerKey(cam: FlatCamera, width: number, height: number, dark: boolean, landCount: number): string {
  return [Math.round(cam.lon * 100), Math.round(cam.lat * 100), Math.round(cam.zoom * 1000), width, height, dark ? 1 : 0, landCount].join("|")
}

/**
 * 两城市之间抬起的二次贝塞尔弧线：两端就是各自在图上的位置（不绕过地图边缘），
 * 弧高随距离增加。at(t) 取点，points() 取折线。
 */
export function flatArc(a: { lat: number; lon: number }, b: { lat: number; lon: number }, cam: FlatCamera, width: number, height: number) {
  const p0 = flatProject(a.lat, a.lon, cam, width, height)
  const p2 = flatProject(b.lat, b.lon, cam, width, height)
  const dist = Math.hypot(p2.x - p0.x, p2.y - p0.y)
  const p1 = { x: (p0.x + p2.x) / 2, y: (p0.y + p2.y) / 2 - Math.min(dist * 0.28, height * 0.3) }
  const at = (t: number) => {
    const u = 1 - t
    return { x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x, y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y }
  }
  const points = (steps = 40) => Array.from({ length: steps + 1 }, (_, i) => at(i / steps))
  return { at, points }
}

export function normalizeView(value: unknown): FlatView {
  return value === "flat" ? "flat" : "globe"
}

type StorageLike = Pick<Storage, "getItem" | "setItem">

/** 读上次选的视图；存储不可用（隐私模式等）时回到地球仪。 */
export function readStoredView(storage?: StorageLike): FlatView {
  try {
    return normalizeView((storage ?? window.localStorage).getItem(FLAT_VIEW_KEY))
  } catch {
    return "globe"
  }
}

export function writeStoredView(view: FlatView, storage?: StorageLike): void {
  try {
    ;(storage ?? window.localStorage).setItem(FLAT_VIEW_KEY, view)
  } catch {
    // 存储不可用时只是不记住偏好
  }
}
