// 平面地图的标签放置：每个标签只贴在自己的圆点旁边（8 个方位里挑第一个不碰撞的），
// 不碰别的标签、不盖住任何圆点；放不下就不画（只留圆点，悬停时再浮出详情）。
// 纯函数：输入不变输出就不变，所以网速涨落不会让标签来回飘；传入上一次的方位时优先沿用，平移缩放时标签不乱跳。
export type Size = { w: number; h: number }
export type Rect = { x: number; y: number; w: number; h: number }
export type LabelItem = {
  key: string
  /** 圆点中心 */
  x: number
  y: number
  /** 圆点的避让半径（含光圈） */
  r: number
  /** 只有城市名的紧凑标签尺寸 */
  name: Size
  /** 带网速的完整标签尺寸；没有网速时与 name 相同 */
  full: Size
  priority: number
  /** 选中的城市：一定显示，且直接用完整标签 */
  pinned?: boolean
}
export type PlacedLabel = Rect & { key: string; mode: "name" | "full"; anchor: number }

/** 方位：0 右上、1 右下、2 左上、3 左下、4 右、5 左、6 上、7 下。 */
export const ANCHORS = [0, 1, 2, 3, 4, 5, 6, 7]
const EDGE = 2
const GAP = 2

export function anchorRect(it: { x: number; y: number; r: number }, size: Size, anchor: number): Rect {
  const g = it.r + 1
  const d = g * 0.72
  const { w, h } = size
  switch (anchor) {
    case 0:
      return { x: it.x + d, y: it.y - d - h, w, h }
    case 1:
      return { x: it.x + d, y: it.y + d, w, h }
    case 2:
      return { x: it.x - d - w, y: it.y - d - h, w, h }
    case 3:
      return { x: it.x - d - w, y: it.y + d, w, h }
    case 4:
      return { x: it.x + g, y: it.y - h / 2, w, h }
    case 5:
      return { x: it.x - g - w, y: it.y - h / 2, w, h }
    case 6:
      return { x: it.x - w / 2, y: it.y - g - h, w, h }
    default:
      return { x: it.x - w / 2, y: it.y + g, w, h }
  }
}

const overlaps = (a: Rect, b: Rect, pad: number) => a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y

export function circleHitsRect(cx: number, cy: number, r: number, rect: Rect): boolean {
  const dx = Math.max(rect.x - cx, 0, cx - (rect.x + rect.w))
  const dy = Math.max(rect.y - cy, 0, cy - (rect.y + rect.h))
  return dx * dx + dy * dy < r * r
}

const inside = (rect: Rect, bounds: Size) => rect.x >= EDGE && rect.y >= EDGE && rect.x + rect.w <= bounds.w - EDGE && rect.y + rect.h <= bounds.h - EDGE

function clampInto(rect: Rect, bounds: Size): Rect {
  return {
    ...rect,
    x: Math.min(Math.max(EDGE, rect.x), Math.max(EDGE, bounds.w - rect.w - EDGE)),
    y: Math.min(Math.max(EDGE, rect.y), Math.max(EDGE, bounds.h - rect.h - EDGE)),
  }
}

/** 完整标签比紧凑标签大才算「完整」；两者一样大（没有网速、或窄屏不显示网速）时永远是紧凑标签，绘制时就不会多画一行。 */
const hasFull = (it: LabelItem) => it.full.w !== it.name.w || it.full.h !== it.name.h

const anchorsFor = (preferred: number | undefined) => (preferred === undefined ? ANCHORS : [preferred, ...ANCHORS.filter((a) => a !== preferred)])

/**
 * 先给所有城市放紧凑标签（优先级高的先挑位置，放不下的隐藏），再按优先级尝试把已放下的升级成带网速的完整标签
 * （方位不变，所以升级不会让标签挪窝）。返回按优先级排序的已放置标签。
 */
export function placeLabels(items: LabelItem[], bounds: Size, previous?: ReadonlyMap<string, number>): PlacedLabel[] {
  const order = items.slice().sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.priority - a.priority || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  const placed = new Map<string, PlacedLabel>()

  const free = (rect: Rect, self?: string) => {
    if (!inside(rect, bounds)) return false
    for (const p of placed.values()) if (p.key !== self && overlaps(rect, p, GAP)) return false
    for (const o of items) if (circleHitsRect(o.x, o.y, o.r + 1, rect)) return false
    return true
  }

  for (const it of order) {
    const sizes: Array<[PlacedLabel["mode"], Size]> = it.pinned && hasFull(it) ? [["full", it.full], ["name", it.name]] : [["name", it.name]]
    let done = false
    for (const [mode, size] of sizes) {
      for (const anchor of anchorsFor(previous?.get(it.key))) {
        const rect = anchorRect(it, size, anchor)
        if (!free(rect)) continue
        placed.set(it.key, { ...rect, key: it.key, mode, anchor })
        done = true
        break
      }
      if (done) break
    }
    if (!done && it.pinned) {
      // 选中的城市必须显示：取第一个不出界的方位，允许压在别的标签上。
      const anchor = ANCHORS.find((a) => inside(anchorRect(it, hasFull(it) ? it.full : it.name, a), bounds)) ?? 0
      const mode = hasFull(it) ? "full" : "name"
      placed.set(it.key, { ...clampInto(anchorRect(it, mode === "full" ? it.full : it.name, anchor), bounds), key: it.key, mode, anchor })
    }
  }

  for (const it of order) {
    const p = placed.get(it.key)
    if (!p || p.mode === "full" || !hasFull(it)) continue
    const rect = anchorRect(it, it.full, p.anchor)
    if (free(rect, it.key)) placed.set(it.key, { ...rect, key: it.key, mode: "full", anchor: p.anchor })
  }

  return order.flatMap((it) => {
    const p = placed.get(it.key)
    return p ? [p] : []
  })
}

/** 悬停时浮出的完整标签：不参与布局（别的标签不挪），优先沿用该城市当前的方位，只要求不出界。 */
export function overlayRect(it: LabelItem, bounds: Size, preferred?: number): Rect {
  for (const anchor of anchorsFor(preferred)) {
    const rect = anchorRect(it, it.full, anchor)
    if (inside(rect, bounds)) return rect
  }
  return clampInto(anchorRect(it, it.full, 0), bounds)
}
