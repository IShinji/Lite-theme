// 地球仪的镜头纯函数：正交投影与反投影、缩放/纬度限制、经度最短路径插值、按区域取景、陆地点阵预处理。
const D = Math.PI / 180

export type GlobeLonLatBox = { lon: [number, number]; lat: [number, number] }
export type GlobeView = { lon: number; lat: number; zoom: number }

export const GLOBE_ZOOM_MIN = 0.7
export const GLOBE_ZOOM_MAX = 4
export const GLOBE_LAT_LIMIT = 65
/** 放大超过这个倍数后不再自动旋转：否则放大看某个区域时过几秒又被转走。 */
export const GLOBE_AUTO_ROTATE_MAX_ZOOM = 1.15

export function clampGlobeZoom(zoom: number): number {
  return Number.isFinite(zoom) ? Math.min(GLOBE_ZOOM_MAX, Math.max(GLOBE_ZOOM_MIN, zoom)) : 1
}

export function clampGlobeLat(lat: number): number {
  return Number.isFinite(lat) ? Math.min(GLOBE_LAT_LIMIT, Math.max(-GLOBE_LAT_LIMIT, lat)) : 0
}

/** 经度折到 (-180, 180]。 */
export function normLon(lon: number): number {
  const v = ((((lon + 180) % 360) + 360) % 360) - 180
  return v === -180 ? 180 : v
}

/** 经度沿最短方向插值（170 → -170 走 20 度，不绕地球一圈）。 */
export function lerpLon(from: number, to: number, t: number): number {
  const diff = ((((to - from + 180) % 360) + 360) % 360) - 180
  return from + diff * t
}

/** 球的半径（像素）：随舞台大小和缩放变化。 */
export function globeRadius(width: number, height: number, zoom: number): number {
  return Math.min(width * 0.39, height * 0.405) * zoom
}

/** 单位球上的点（x 向右、y 向上、z 朝向观察者，镜头 lon=0 lat=0 时）。 */
export function globeUnit(lat: number, lon: number): [number, number, number] {
  return [Math.cos(lat * D) * Math.sin(lon * D), Math.sin(lat * D), Math.cos(lat * D) * Math.cos(lon * D)]
}

/** 正交投影（单位球）：镜头对准 (lonC, latC) 时，经纬度 → u 向右、v 向上、z 朝向观察者（z>0 才在正面）。与组件里的画法一致。 */
export function orthoProject(lat: number, lon: number, lonC: number, latC: number) {
  const [v0, v1, v2] = globeUnit(lat, lon)
  const yaw = lonC * D
  const pitch = latC * D
  const x = v0 * Math.cos(yaw) - v2 * Math.sin(yaw)
  const z0 = v0 * Math.sin(yaw) + v2 * Math.cos(yaw)
  const y = v1 * Math.cos(pitch) - z0 * Math.sin(pitch)
  const z = v1 * Math.sin(pitch) + z0 * Math.cos(pitch)
  return { u: x, v: y, z }
}

/** 反投影：球面上屏幕位置 (u, v)（单位球坐标）对应的经纬度；在球外返回 null。 */
export function orthoInverse(u: number, v: number, lonC: number, latC: number): { lat: number; lon: number } | null {
  const r2 = u * u + v * v
  if (!(r2 <= 1)) return null
  const z = Math.sqrt(1 - r2)
  const yaw = lonC * D
  const pitch = latC * D
  const v1 = v * Math.cos(pitch) + z * Math.sin(pitch)
  const z0 = -v * Math.sin(pitch) + z * Math.cos(pitch)
  const v0 = u * Math.cos(yaw) + z0 * Math.sin(yaw)
  const v2 = -u * Math.sin(yaw) + z0 * Math.cos(yaw)
  return { lat: Math.asin(Math.max(-1, Math.min(1, v1))) / D, lon: Math.atan2(v0, v2) / D }
}

/**
 * 按区域取景：镜头转到区域中心，放大到整个区域刚好放进舞台（四周留 pad 比例的边）。
 * 区域大到一个半球放不下时不放大（zoom 1）。
 */
export function globeFitCamera(box: GlobeLonLatBox, width: number, height: number, pad = 0.1): GlobeView {
  const lon = (box.lon[0] + box.lon[1]) / 2
  const lat = clampGlobeLat((box.lat[0] + box.lat[1]) / 2)
  let hu = 0
  let hv = 0
  const steps = 12
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const lo = box.lon[0] + (box.lon[1] - box.lon[0]) * t
    const la = box.lat[0] + (box.lat[1] - box.lat[0]) * t
    for (const [pla, plo] of [
      [box.lat[0], lo],
      [box.lat[1], lo],
      [la, box.lon[0]],
      [la, box.lon[1]],
    ]) {
      const p = orthoProject(pla, plo, lon, lat)
      if (p.z <= 0.05) return { lon, lat, zoom: 1 }
      hu = Math.max(hu, Math.abs(p.u))
      hv = Math.max(hv, Math.abs(p.v))
    }
  }
  const need = Math.min(((width / 2) * (1 - 2 * pad)) / Math.max(hu, 1e-3), ((height / 2) * (1 - 2 * pad)) / Math.max(hv, 1e-3))
  return { lon, lat, zoom: clampGlobeZoom(Math.max(1, need / globeRadius(width, height, 1))) }
}

/** 装饰（轨道环、底座）的透明度：放大后它们会变成横贯画面的大椭圆，渐隐掉。 */
export function decoAlpha(zoom: number): number {
  return Math.max(0, Math.min(1, (1.8 - zoom) / 0.5))
}

/**
 * 舞台上看得到的球面范围（经纬度窗口），用来只算这一块的陆地点。
 * 在舞台矩形上取一圈格点，超出球面的点收到球的边缘上，再用反投影换成经纬度，取外接范围，四周多留 3 度；
 * 南北极点在画面里时经度取满 360 度。球完整在画面里时自然是整个半球，放大后是一小块。
 */
export function globeVisibleWindow(lonC: number, latC: number, radius: number, cx: number, cy: number, width: number, height: number) {
  const margin = 3
  const full = (latMin: number, latMax: number) => ({ lonMin: -180, lonMax: 180, latMin: Math.max(-90, latMin), latMax: Math.min(90, latMax) })
  for (const pole of [90, -90]) {
    const p = orthoProject(pole, 0, lonC, latC)
    const x = cx + p.u * radius
    const y = cy - p.v * radius
    if (p.z > 0 && x >= 0 && x <= width && y >= 0 && y <= height) return full(pole > 0 ? latC - 90 : -90, pole > 0 ? 90 : latC + 90)
  }
  let latMin = 90
  let latMax = -90
  let relMin = 180
  let relMax = -180
  const n = 24
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n; j++) {
      let dx = (width * i) / n - cx
      let dy = (height * j) / n - cy
      const d = Math.hypot(dx, dy)
      if (d > radius * 0.9999) {
        dx *= (radius * 0.9999) / d
        dy *= (radius * 0.9999) / d
      }
      const g = orthoInverse(dx / radius, -dy / radius, lonC, latC)
      if (!g) continue
      latMin = Math.min(latMin, g.lat)
      latMax = Math.max(latMax, g.lat)
      const rel = ((((g.lon - lonC + 180) % 360) + 360) % 360) - 180
      relMin = Math.min(relMin, rel)
      relMax = Math.max(relMax, rel)
    }
  }
  if (latMin > latMax) return full(latC - 90, latC + 90)
  if (relMax - relMin + 2 * margin >= 360) return full(latMin - margin, latMax + margin)
  return { lonMin: lonC + relMin - margin, lonMax: lonC + relMax + margin, latMin: Math.max(-90, latMin - margin), latMax: Math.min(90, latMax + margin) }
}
