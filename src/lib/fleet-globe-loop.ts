export type MotionSetting = "auto" | "on" | "off"

/** auto 跟随系统「减弱动态效果」；on 总是播放；off 总是静态。 */
export function resolveMotion(setting: MotionSetting, systemReduced: boolean): boolean {
  if (setting === "on") return true
  if (setting === "off") return false
  return !systemReduced
}

/** 连线圆弧在球体正面的可见线段首尾；整条都在背面时返回 null（绘制时跳过，不能抛异常）。 */
export function arcEnds(segments: Array<Array<{ x: number; y: number }>>): { first: { x: number; y: number }; last: { x: number; y: number } } | null {
  const usable = segments.filter((s) => s.length > 1)
  if (!usable.length) return null
  const lastSeg = usable[usable.length - 1]
  return { first: usable[0][0], last: lastSeg[lastSeg.length - 1] }
}

export type RenderLoopOptions = {
  raf: (cb: (t: number) => void) => number
  caf: (id: number) => void
  render: (now: number) => void
  playing: () => boolean
  canRun: () => boolean
  onError: (e: unknown) => void
}

/**
 * 绘制循环：playing 时常驻 rAF；静态（减弱动态）时只在 invalidate 后画一帧。
 * 单帧异常 catch 后只上报一次，循环继续；页面不可见时 canRun 为 false，恢复时 start() 补画。
 */
export function createRenderLoop(o: RenderLoopOptions) {
  let id = 0
  let dirty = true
  let reported = false
  const schedule = () => {
    if (!id) id = o.raf(tick)
  }
  function tick(now: number) {
    id = 0
    if (!o.canRun()) return
    dirty = false
    try {
      o.render(now)
    } catch (e) {
      if (!reported) {
        reported = true
        o.onError(e)
      }
    }
    if (o.playing() || dirty) schedule()
  }
  const invalidate = () => {
    dirty = true
    if (o.canRun()) schedule()
  }
  return {
    invalidate,
    start: invalidate,
    stop() {
      if (id) o.caf(id)
      id = 0
    },
  }
}

export type Projected = { x: number; y: number; z: number }
const RAD = Math.PI / 180
const unit = (lat: number, lon: number) => [Math.cos(lat * RAD) * Math.sin(lon * RAD), Math.sin(lat * RAD), Math.cos(lat * RAD) * Math.cos(lon * RAD)]

/** 两城市之间抬离球面的大圆弧：at(t) 取点，segments() 取球体正面的可见线段（可能为空）。 */
export function makeArc(a: { lat: number; lon: number }, b: { lat: number; lon: number }, project: (v: number[], alt: number) => Projected) {
  const av = unit(a.lat, a.lon)
  const bv = unit(b.lat, b.lon)
  const omega = Math.acos(Math.max(-1, Math.min(1, av.reduce((s, x, i) => s + x * bv[i], 0))))
  const sine = Math.sin(omega)
  const at = (t: number) => {
    const f = sine ? Math.sin((1 - t) * omega) / sine : 1 - t
    const g = sine ? Math.sin(t * omega) / sine : t
    return project(av.map((x, i) => x * f + bv[i] * g), 1 + Math.sin(t * Math.PI) * (0.11 + omega * 0.06))
  }
  const segments = () => {
    const out: Projected[][] = []
    let seg: Projected[] = []
    for (let i = 0; i <= 64; i++) {
      const p = at(i / 64)
      if (p.z < -0.02) {
        if (seg.length > 1) out.push(seg)
        seg = []
        continue
      }
      seg.push(p)
    }
    if (seg.length > 1) out.push(seg)
    return out
  }
  return { at, segments }
}
