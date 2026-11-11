// 热力图：城市里机器越多，光斑越大、越热（青 → 黄 → 橙 → 红）。纯函数，地球仪与平面地图共用。
import type { City } from "@/lib/fleet-globe-data"

const STOPS: Array<[number, [number, number, number]]> = [
  [0, [48, 196, 168]],
  [0.45, [255, 214, 90]],
  [0.75, [255, 140, 52]],
  [1, [255, 64, 58]],
]

/** 0..1：最少的城市（1 台）约 0.15，最多的城市为 1；所有城市都只有 1 台时不渲染成「最热」，固定 0.2。 */
export function heatLevel(count: number, max: number): number {
  if (!(count > 0)) return 0
  if (max <= 1) return 0.2
  return 0.15 + (0.85 * (Math.min(count, max) - 1)) / (max - 1)
}

export function heatColor(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t))
  for (let i = 1; i < STOPS.length; i++) {
    const [t1, c1] = STOPS[i]
    if (x <= t1) {
      const [t0, c0] = STOPS[i - 1]
      const k = (x - t0) / (t1 - t0)
      return [0, 1, 2].map((j) => Math.round(c0[j] + (c1[j] - c0[j]) * k)) as [number, number, number]
    }
  }
  return STOPS[STOPS.length - 1][1]
}

export function maxMachines(cities: City[]): number {
  return cities.reduce((m, c) => Math.max(m, c.nodes.length), 0)
}

/** 画一个城市的热点光斑。unit 是「一档半径」的像素值（随缩放变化），alpha 用于地球边缘渐隐。 */
export function paintHeat(ctx: CanvasRenderingContext2D, x: number, y: number, t: number, unit: number, dark: boolean, alpha = 1) {
  const [r, g, b] = heatColor(t)
  const radius = unit * (0.8 + 1.7 * t)
  const peak = (dark ? 0.85 : 0.7) * (0.6 + 0.4 * t) * alpha
  const grad = ctx.createRadialGradient(x, y, 0, x, y, radius)
  grad.addColorStop(0, `rgba(${r},${g},${b},${peak.toFixed(3)})`)
  grad.addColorStop(0.5, `rgba(${r},${g},${b},${(peak * 0.5).toFixed(3)})`)
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`)
  ctx.save()
  if (dark) ctx.globalCompositeOperation = "lighter"
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}
