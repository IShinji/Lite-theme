// 城市标签的画布绘制，平面地图和地球仪共用：量字宽（带缓存）、生成放置用的标签项、放置并绘制，悬停时浮出完整标签。
// 放置逻辑在 fleet-flat-labels.ts（纯函数、有单测），这里只负责把城市数据变成标签项并画出来。
import { overlayRect, placeLabels, type LabelItem, type Rect } from "./fleet-flat-labels.ts"
import type { City } from "./fleet-globe-data.ts"
import { SPEED_SLOT, rateCompact, stablePriority } from "./fleet-globe-layout.ts"
import type { Palette } from "./fleet-globe-style.ts"

export const NAME_FONT = "600 11px -apple-system, sans-serif"
export const SPEED_FONT = "9px ui-monospace, monospace"

function drawLabel(ctx: CanvasRenderingContext2D, rect: Rect, text: string, speed: string, nameW: number, full: boolean, strong: boolean, pal: Palette) {
  const { x, y, w, h } = rect
  ctx.fillStyle = strong ? pal.labelBgSelected : pal.labelBg
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, 4)
  ctx.fill()
  ctx.strokeStyle = pal.labelBorder
  ctx.lineWidth = 0.8
  ctx.stroke()
  ctx.fillStyle = pal.labelName
  ctx.font = NAME_FONT
  ctx.fillText(text, x + 6, y + 11.5)
  if (speed) {
    ctx.fillStyle = pal.labelSpeed
    ctx.font = SPEED_FONT
    // 两行版：速度在名字下面；单行版（被挤时）：速度紧跟名字后，网速不会因为拥挤而消失。
    if (full) ctx.fillText(speed, x + 6, y + 21.5)
    else ctx.fillText(speed, x + 6 + nameW + 5, y + 11.5)
  }
}

/** 每个画布一个：缓存字宽，并记住上一帧每个标签的方位（沿用，平移/旋转/缩放时标签不乱跳）。 */
export function createLabelPainter(ctx: CanvasRenderingContext2D) {
  const widths = new Map<string, number>()
  const texts = new Map<string, { text: string; speed: string; nameW: number }>()
  let items: LabelItem[] = []
  let anchors = new Map<string, number>()

  const measure = (font: string, text: string) => {
    const k = `${font}|${text}`
    let w = widths.get(k)
    if (w === undefined) {
      ctx.font = font
      w = ctx.measureText(text).width
      widths.set(k, w)
    }
    return w
  }

  return {
    /** 一帧开始：清空标签项。 */
    begin() {
      items = []
      texts.clear()
    },
    /** 加入一座城市：(x, y) 是它的圆点；compact（窄屏）时默认只显示城市名，选中时才展开网速。 */
    add(c: City, x: number, y: number, selected: boolean, compact: boolean) {
      const text = c.name + (c.nodes.length > 1 ? ` · ${c.nodes.length}` : "")
      const speed = c.visitor ? "你的位置" : c.hasData ? `↓${rateCompact(c.down)} ↑${rateCompact(c.up)}` : ""
      const nameW = measure(NAME_FONT, text)
      // 单行版同样带速度（窄屏默认不带，选中时才展开）；宽度按占位文字量，不随网速伸缩。
      const inline = speed && !compact ? measure(SPEED_FONT, SPEED_SLOT) + 5 : 0
      const name = { w: nameW + 10 + inline, h: 16 }
      texts.set(c.name, { text, speed: speed && (!compact || selected) ? speed : "", nameW })
      items.push({
        key: c.name,
        x,
        y,
        r: selected ? 9.5 : 7,
        name,
        // 速度行按固定宽度占位，标签大小不随实时网速伸缩。
        full: speed && (!compact || selected) ? { w: Math.max(nameW, measure(SPEED_FONT, SPEED_SLOT)) + 12, h: 25 } : name,
        priority: stablePriority(c),
        pinned: selected,
      })
    },
    /** 放置并绘制：贴着各自的圆点，不碰别的标签、不盖别的点；悬停的城市浮出完整标签（画在最上面，不参与布局）。 */
    draw(bounds: { w: number; h: number }, pal: Palette, selected: string, hovered: string) {
      const placed = placeLabels(items, bounds, anchors)
      anchors = new Map(placed.map((p) => [p.key, p.anchor]))
      for (const p of placed.slice().reverse()) {
        const t = texts.get(p.key)
        if (t) drawLabel(ctx, p, t.text, t.speed, t.nameW, p.mode === "full", p.key === selected || p.key === hovered, pal)
      }
      const item = hovered ? items.find((i) => i.key === hovered) : undefined
      const t = hovered ? texts.get(hovered) : undefined
      if (item && t) {
        const base = placed.find((p) => p.key === hovered)
        const rect = base && base.mode === "full" ? base : overlayRect(item, bounds, base?.anchor)
        drawLabel(ctx, rect, t.text, t.speed, t.nameW, true, true, pal)
      }
    },
  }
}
