// 陆地点阵：从陆地掩膜（等距圆柱栅格）里按屏幕间距均匀采样，放大时自动变密，海岸线越放越清楚。纯函数、可单测。
export type LandMask = { w: number; h: number; data: Uint8Array }
export type DotWindow = { lonMin: number; lonMax: number; latMin: number; latMax: number }

const D = Math.PI / 180
const ROW = Math.sqrt(3) / 2

/** 点距档位（度），相邻档位相差 √2 倍：缩放时点阵变化平缓，不会一下子「弹」一大截。 */
export const PITCH_LEVELS = [2.4, 1.7, 1.2, 0.85, 0.6, 0.42, 0.3, 0.21]
/** 屏幕上的点距上限（像素）：选满足它的最粗一档。缩小时约 4px；放大到区域级后逐步放宽到 7.5px，放大后更通透，不会糊成一片。 */
export const MAX_SCREEN_PITCH = 4.9
export function maxScreenPitch(pxPerDeg: number): number {
  return Math.min(7.5, MAX_SCREEN_PITCH + Math.max(0, pxPerDeg - 4) * 0.3)
}

export function pickPitch(pxPerDeg: number, maxPx = maxScreenPitch(pxPerDeg)): number {
  for (const p of PITCH_LEVELS) if (p * pxPerDeg <= maxPx) return p
  return PITCH_LEVELS[PITCH_LEVELS.length - 1]
}

/** 掩膜上 (lon, lat) 是不是陆地；经度循环，纬度越界算海。 */
export function isLand(mask: LandMask, lon: number, lat: number): boolean {
  const y = Math.floor(((90 - lat) / 180) * mask.h)
  if (y < 0 || y >= mask.h) return false
  const fx = ((((lon + 180) / 360) % 1) + 1) % 1
  return mask.data[y * mask.w + Math.min(mask.w - 1, Math.floor(fx * mask.w))] > 127
}

/**
 * 遍历窗口内的陆地点。点阵是按绝对经纬度定死的蜂窝状排列（行距 = 点距 × √3/2，奇数行错开半个点距），
 * 与窗口无关，所以平移、旋转时点的位置不动，不会闪烁；窗口只决定算哪一块。
 * equalArea：球面用，每行的点数随 cos(纬度) 变化，单位面积的点数一致（高纬度不会挤成同心圆）；平面地图用等距行（false）。
 */
export function forEachLandDot(mask: LandMask, pitch: number, win: DotWindow, equalArea: boolean, fn: (lon: number, lat: number) => void): void {
  const rowStep = pitch * ROW
  const rows = Math.floor(180 / rowStep)
  const j0 = Math.max(0, Math.floor((win.latMin + 90) / rowStep - 0.5))
  const j1 = Math.min(rows, Math.ceil((win.latMax + 90) / rowStep - 0.5))
  const full = win.lonMax - win.lonMin >= 360
  for (let j = j0; j <= j1; j++) {
    const lat = -90 + (j + 0.5) * rowStep
    if (lat > 90) continue
    const n = Math.max(1, Math.round((equalArea ? 360 * Math.cos(lat * D) : 360) / pitch))
    const step = 360 / n
    const offset = j & 1 ? step / 2 : 0
    const i0 = full ? 0 : Math.floor((win.lonMin + 180 - offset) / step - 0.5)
    const i1 = full ? n - 1 : Math.ceil((win.lonMax + 180 - offset) / step - 0.5)
    for (let i = i0; i <= i1; i++) {
      const lon = -180 + (i + 0.5) * step + offset
      if (isLand(mask, lon, lat)) fn(lon, lat)
    }
  }
}
