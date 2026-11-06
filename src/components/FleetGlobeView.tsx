// 节点地球仪（Canvas 2D 手写正交投影）：移植自本机「节点星图」fleet-globe，球体、连线、节点的画法保持原样。
// 标签、缩放、区域取景与平面地图共用同一套逻辑：标签贴着各自的圆点、先显示城市名再补网速，悬停浮出详情；
// 区域按钮会把地球转到该区域并放大，Ctrl/⌘ + 滚轮缩放，双击把点击处转到中央并放大。
import { geoOrthographic, geoPath } from "d3-geo"
import { Minus, Move, Pause, Play, Plus, RotateCcw } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import RegionChips from "@/components/RegionChips"
import { regionsWithCities } from "@/lib/fleet-flatmap"
import {
  GLOBE_AUTO_ROTATE_MAX_ZOOM,
  clampGlobeLat,
  clampGlobeZoom,
  decoAlpha,
  globeFitCamera,
  globeRadius,
  globeVisibleWindow,
  globeUnit,
  lerpLon,
  normLon,
  orthoInverse,
  type GlobeView,
} from "@/lib/fleet-globe-camera"
import type { City, GlobeLink } from "@/lib/fleet-globe-data"
import { createLabelPainter } from "@/lib/fleet-label-canvas"
import { dotHash, initialView } from "@/lib/fleet-globe-layout"
import { arcEnds, createRenderLoop, makeArc, resolveMotion } from "@/lib/fleet-globe-loop"
import { RING_COUNT, cityStates, dotAlpha, globePalette, kindColors, ringState, rgba, staticLayerKey, type Palette } from "@/lib/fleet-globe-style"
import { readGlobeMotion } from "@/lib/theme-config"
import { forEachLandDot, pickPitch } from "@/lib/world-dots"
import { loadWorld, type World } from "@/lib/world-geo"

type Props = { cities: City[]; links: GlobeLink[]; selected: string; onSelect: (city: string) => void; filter: string; dark: boolean }
type Cam = GlobeView & { lastInteraction: number }
type Flight = { from: Cam; to: GlobeView; t0: number }

const D = Math.PI / 180
const HIT_RADIUS = 18
const FLIGHT_MS = 520

export default function FleetGlobeView(props: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const caption = useRef<HTMLDivElement>(null)
  const latest = useRef(props)
  const camera = useRef<Cam>({ lon: 168, lat: 21, zoom: 1, lastInteraction: 0 })
  const size = useRef({ width: 800, height: 620 })
  const drag = useRef({ active: false, x: 0, y: 0, moved: false })
  const hit = useRef<Array<{ x: number; y: number; name: string }>>([])
  const hover = useRef("")
  const flight = useRef<Flight | null>(null)
  const invalidate = useRef<() => void>(() => {})
  const viewSet = useRef(false)
  const [rotating, setRotating] = useState(() => resolveMotion(readGlobeMotion(), window.matchMedia("(prefers-reduced-motion: reduce)").matches))
  const rotateRef = useRef(rotating)
  const [world, setWorld] = useState<World | null>(null)
  const [region, setRegion] = useState("world")
  const regions = useMemo(() => regionsWithCities(props.cities), [props.cities])
  const regionsRef = useRef(regions)

  useEffect(() => {
    latest.current = props
    invalidate.current()
  }, [props])
  useEffect(() => {
    regionsRef.current = regions
  }, [regions])
  useEffect(() => {
    if (viewSet.current || !props.cities.length) return
    viewSet.current = true
    if (camera.current.lastInteraction) return
    const v = initialView(props.cities)
    camera.current.lon = v.lon
    camera.current.lat = v.lat
  }, [props.cities])
  useEffect(() => {
    rotateRef.current = rotating
    invalidate.current()
  }, [rotating])
  useEffect(() => {
    let alive = true
    loadWorld()
      .then((w) => {
        if (alive) setWorld(w)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  // 镜头操作只碰 ref 和稳定的 setState，所以都是稳定的回调，滚轮监听（要 passive:false，只能自己 addEventListener）可以放心引用。
  const manual = useCallback(() => {
    flight.current = null
    camera.current.lastInteraction = performance.now()
    setRegion("")
  }, [])
  const flyTo = useCallback((target: GlobeView) => {
    const to = { lon: normLon(target.lon), lat: clampGlobeLat(target.lat), zoom: clampGlobeZoom(target.zoom) }
    if (!rotateRef.current) {
      // 动画关闭（含系统「减弱动态效果」）：直接跳过去。
      flight.current = null
      camera.current = { ...to, lastInteraction: performance.now() }
    } else {
      flight.current = { from: { ...camera.current }, to, t0: -1 }
    }
    invalidate.current()
  }, [])
  const zoomBy = useCallback(
    (factor: number) => {
      manual()
      camera.current.zoom = clampGlobeZoom(camera.current.zoom * factor)
      invalidate.current()
    },
    [manual],
  )
  const goRegion = (key: string) => {
    setRegion(key)
    const box = regionsRef.current.find((r) => r.key === key)
    if (box) {
      flyTo(globeFitCamera(box, size.current.width, size.current.height))
    } else {
      const v = initialView(latest.current.cities)
      flyTo({ lon: v.lon, lat: v.lat, zoom: 1 })
    }
  }

  useEffect(() => {
    const el = canvas.current
    const container = wrap.current
    if (!el || !container) return
    const context = el.getContext("2d")
    if (!context) return
    const ctx = context
    let width = 800
    let height = 620
    let dpr = 1
    let previous = 0
    let visible = true
    let cacheKey = ""
    const layer = document.createElement("canvas")
    const lctx = layer.getContext("2d")
    const labels = createLabelPainter(ctx)

    const resize = () => {
      width = container.clientWidth
      height = container.clientHeight
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      el.width = width * dpr
      el.height = height * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      layer.width = el.width
      layer.height = el.height
      size.current = { width, height }
      cacheKey = ""
      invalidate.current()
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(container)

    const geometry = (cam: GlobeView) => {
      const radius = globeRadius(width, height, cam.zoom)
      const cx = width * 0.5
      const cy = height * 0.49
      const yaw = cam.lon * D
      const pitch = cam.lat * D
      const project = (v: number[], alt = 1) => {
        const x = v[0] * Math.cos(yaw) - v[2] * Math.sin(yaw)
        const z0 = v[0] * Math.sin(yaw) + v[2] * Math.cos(yaw)
        const y = v[1] * Math.cos(pitch) - z0 * Math.sin(pitch)
        const z = v[1] * Math.sin(pitch) + z0 * Math.cos(pitch)
        return { x: cx + x * radius * alt, y: cy - y * radius * alt, z }
      }
      return { radius, cx, cy, project, point: (lat: number, lon: number) => project(globeUnit(lat, lon)) }
    }

    // 静态层：大气光晕、底座椭圆、玻璃球体、经纬网、点阵陆地、高光与边缘光。只在镜头变化超过 0.1 度、尺寸或主题变化时重绘。
    const paintStatic = (c: CanvasRenderingContext2D, cam: GlobeView, pal: Palette) => {
      const { radius, cx, cy, point } = geometry(cam)
      const deco = decoAlpha(cam.zoom)
      c.setTransform(dpr, 0, 0, dpr, 0, 0)
      c.clearRect(0, 0, width, height)
      const halo = c.createRadialGradient(cx, cy, radius * 0.7, cx, cy, radius * 1.42)
      halo.addColorStop(0, pal.halo[0])
      halo.addColorStop(1, pal.halo[1])
      c.fillStyle = halo
      c.fillRect(0, 0, width, height)
      if (deco > 0) {
        c.save()
        c.globalAlpha = deco
        c.translate(cx, cy + radius * 1.16)
        c.scale(1, 0.15)
        const plate = c.createRadialGradient(0, 0, radius * 0.2, 0, 0, radius * 1.3)
        plate.addColorStop(0, pal.platform)
        plate.addColorStop(1, "rgba(0,0,0,0)")
        c.fillStyle = plate
        c.beginPath()
        c.arc(0, 0, radius * 1.3, 0, Math.PI * 2)
        c.fill()
        c.strokeStyle = pal.platformLine
        c.lineWidth = 1
        for (const k of [0.62, 0.83, 1.02, 1.2]) {
          c.beginPath()
          c.arc(0, 0, radius * k, 0, Math.PI * 2)
          c.stroke()
        }
        c.restore()
      }
      // 略倾斜的外层轨道环：后半在球体之后，前半在球体之前。
      const ringPath = (c2: CanvasRenderingContext2D, from: number, to: number) => {
        c2.beginPath()
        c2.ellipse(cx, cy + radius * 0.04, radius * 1.42, radius * 0.27, -0.32, from, to)
      }
      const ringStroke = (c2: CanvasRenderingContext2D, from: number, to: number) => {
        if (deco <= 0) return
        c2.save()
        c2.globalAlpha = deco
        const g = c2.createLinearGradient(cx - radius * 1.45, cy, cx + radius * 1.45, cy)
        g.addColorStop(0, `rgba(${pal.ring},0)`)
        g.addColorStop(0.25, `rgba(${pal.ring},.5)`)
        g.addColorStop(0.75, `rgba(${pal.ring},.5)`)
        g.addColorStop(1, `rgba(${pal.ring},0)`)
        ringPath(c2, from, to)
        c2.strokeStyle = `rgba(${pal.ring},.1)`
        c2.lineWidth = 7
        c2.stroke()
        ringPath(c2, from, to)
        c2.strokeStyle = g
        c2.lineWidth = 1.2
        c2.stroke()
        c2.restore()
      }
      ringStroke(c, Math.PI, Math.PI * 2)
      const fill = c.createRadialGradient(cx - radius * 0.37, cy - radius * 0.42, radius * 0.05, cx + radius * 0.22, cy + radius * 0.25, radius * 1.22)
      fill.addColorStop(0, pal.sphere[0])
      fill.addColorStop(0.43, pal.sphere[1])
      fill.addColorStop(0.8, pal.sphere[2])
      fill.addColorStop(1, pal.sphere[3])
      c.beginPath()
      c.arc(cx, cy, radius, 0, Math.PI * 2)
      c.fillStyle = fill
      c.shadowColor = pal.glow
      c.shadowBlur = 32
      c.fill()
      c.shadowBlur = 0
      c.save()
      c.beginPath()
      c.arc(cx, cy, radius, 0, Math.PI * 2)
      c.clip()
      const trace = (coords: number[][], color: string) => {
        c.beginPath()
        let open = false
        for (const k of coords) {
          const p = point(k[1], k[0])
          if (p.z < 0) {
            open = false
            continue
          }
          if (open) c.lineTo(p.x, p.y)
          else {
            c.moveTo(p.x, p.y)
            open = true
          }
        }
        c.strokeStyle = color
        c.lineWidth = 0.6
        c.stroke()
      }
      for (let lat = -60; lat <= 60; lat += 30) {
        const k = []
        for (let lon = -180; lon <= 180; lon += 3) k.push([lon, lat])
        trace(k, `rgba(${pal.grid},${pal.gridAlpha})`)
      }
      for (let lon = -180; lon < 180; lon += 30) {
        const k = []
        for (let lat = -90; lat <= 90; lat += 3) k.push([lon, lat])
        trace(k, `rgba(${pal.grid},${pal.gridAlpha * 0.85})`)
      }
      // 陆地：矢量底色 + 从陆地掩膜采样的细点阵（等面积排布，点距随缩放变密）+ 矢量海岸线（放大后再加国界）。
      if (world) {
        const pxDeg = radius * D
        const detail = pxDeg >= 6.7 ? world.fine : world.coarse
        const path = geoPath(geoOrthographic().translate([cx, cy]).scale(radius).rotate([-cam.lon, -cam.lat]).clipAngle(90).precision(0.6), c)
        c.fillStyle = `rgba(${pal.land},${pal.dark ? 0.1 : 0.12})`
        c.beginPath()
        path(detail.land)
        c.fill()
        // 点阵：按深度（越靠边越淡）× 随机亮度分 12 档批量绘制；点的大小随点距走，越靠边越小。
        const step = pickPitch(pxDeg)
        const base = Math.min(1.7, Math.max(0.7, step * pxDeg * 0.27))
        const yaw = cam.lon * D
        const pitch = cam.lat * D
        const cyaw = Math.cos(yaw)
        const syaw = Math.sin(yaw)
        const cp = Math.cos(pitch)
        const sp = Math.sin(pitch)
        const buckets: number[][] = Array.from({ length: 12 }, () => [])
        forEachLandDot(world.mask, step, globeVisibleWindow(cam.lon, cam.lat, radius, cx, cy, width, height), true, (lon, lat) => {
          const cl = Math.cos(lat * D)
          const v0 = cl * Math.sin(lon * D)
          const v1 = Math.sin(lat * D)
          const v2 = cl * Math.cos(lon * D)
          const z0 = v0 * syaw + v2 * cyaw
          const z = v1 * sp + z0 * cp
          if (z <= 0) return
          const px = cx + (v0 * cyaw - v2 * syaw) * radius
          const py = cy - (v1 * cp - z0 * sp) * radius
          if (px < -4 || px > width + 4 || py < -4 || py > height + 4) return
          buckets[Math.min(5, Math.floor(z * 6)) * 2 + (dotHash(lon, lat) > 0.5 ? 1 : 0)].push(px, py, z)
        })
        buckets.forEach((list, i) => {
          if (!list.length) return
          const z = (Math.floor(i / 2) + 0.5) / 6
          const tint = i % 2 ? 1 : 0.72
          c.fillStyle = `rgba(${pal.land},${(dotAlpha(z) * tint).toFixed(3)})`
          c.beginPath()
          for (let k = 0; k < list.length; k += 3) {
            const r = base * (0.55 + 0.45 * list[k + 2])
            c.moveTo(list[k] + r, list[k + 1])
            c.arc(list[k], list[k + 1], r, 0, Math.PI * 2)
          }
          c.fill()
        })
        c.strokeStyle = `rgba(${pal.land},${pal.dark ? 0.4 : 0.45})`
        c.lineWidth = 0.7
        c.beginPath()
        path(detail.coast)
        c.stroke()
        if (pxDeg >= 6.7) {
          c.strokeStyle = `rgba(${pal.land},${pal.dark ? 0.2 : 0.24})`
          c.lineWidth = 0.5
          c.beginPath()
          path(detail.borders)
          c.stroke()
        }
      }
      // 左上高光、右下暗角与边缘光。
      const spec = c.createRadialGradient(cx - radius * 0.4, cy - radius * 0.46, 0, cx - radius * 0.4, cy - radius * 0.46, radius * 0.8)
      spec.addColorStop(0, `rgba(${pal.highlight},${pal.highlightAlpha})`)
      spec.addColorStop(1, `rgba(${pal.highlight},0)`)
      c.fillStyle = spec
      c.fillRect(cx - radius, cy - radius, radius * 2, radius * 2)
      const shade = c.createRadialGradient(cx + radius * 0.3, cy + radius * 0.35, radius * 0.35, cx + radius * 0.1, cy + radius * 0.1, radius * 1.05)
      shade.addColorStop(0, `rgba(${pal.shade},0)`)
      shade.addColorStop(1, `rgba(${pal.shade},${pal.shadeAlpha})`)
      c.fillStyle = shade
      c.fillRect(cx - radius, cy - radius, radius * 2, radius * 2)
      const rim = c.createRadialGradient(cx, cy, radius * 0.8, cx, cy, radius)
      rim.addColorStop(0, `rgba(${pal.rim},0)`)
      rim.addColorStop(0.82, `rgba(${pal.rim},${pal.rimAlpha * 0.2})`)
      rim.addColorStop(1, `rgba(${pal.rim},${pal.rimAlpha})`)
      c.fillStyle = rim
      c.fillRect(cx - radius, cy - radius, radius * 2, radius * 2)
      c.restore()
      c.strokeStyle = pal.edge
      c.lineWidth = 1
      c.beginPath()
      c.arc(cx, cy, radius, 0, Math.PI * 2)
      c.stroke()
      ringStroke(c, 0, Math.PI)
    }

    const render = (now: number) => {
      const playing = rotateRef.current
      const dt = previous ? Math.min(now - previous, 40) : 16
      previous = now
      const cam = camera.current
      const f = flight.current
      if (f) {
        // 区域取景 / 双击：镜头沿最短方向转过去，缩放按对数插值。
        if (f.t0 < 0) f.t0 = now
        const k = Math.min(1, (now - f.t0) / FLIGHT_MS)
        const e = 1 - Math.pow(1 - k, 3)
        cam.lon = lerpLon(f.from.lon, f.to.lon, e)
        cam.lat = f.from.lat + (f.to.lat - f.from.lat) * e
        cam.zoom = f.from.zoom * Math.pow(f.to.zoom / f.from.zoom, e)
        cam.lastInteraction = now
        if (k >= 1) flight.current = null
        else invalidate.current()
      } else if (playing && !drag.current.active && now - cam.lastInteraction > 5500 && cam.zoom <= GLOBE_AUTO_ROTATE_MAX_ZOOM) {
        cam.lon += dt * 0.0016
      }
      // 放大后左上角的标题会压住节点，渐隐掉。
      const cap = caption.current
      if (cap) {
        const hide = cam.zoom > 1.25 ? "1" : "0"
        if (cap.dataset.hide !== hide) cap.dataset.hide = hide
      }
      const current = latest.current
      const pal = globePalette(current.dark)
      const colors = kindColors(current.dark)
      const { project, point } = geometry(cam)
      const key = staticLayerKey(cam, width, height, current.dark, world ? 1 : 0)
      if (key !== cacheKey && lctx) {
        paintStatic(lctx, cam, pal)
        cacheKey = key
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, el.width, el.height)
      ctx.drawImage(layer, 0, 0)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const byName = new Map(current.cities.map((c) => [c.name, c]))
      const seen = new Set<string>()
      for (const link of current.links) {
        if (current.filter !== "all" && link.kind !== current.filter) continue
        const a = byName.get(link.from)
        const b = byName.get(link.to)
        if (!a || !b || a.name === b.name) continue
        const dedupe = `${a.name}|${b.name}|${link.kind}`
        if (seen.has(dedupe)) continue
        seen.add(dedupe)
        const arc = makeArc(a, b, project)
        const at = arc.at
        const color = colors[link.kind] || colors.exit
        const down = link.state === "down"
        const active = link.state === "active"
        const pts = arc.segments()
        const trace = () => {
          ctx.beginPath()
          for (const sg of pts) {
            ctx.moveTo(sg[0].x, sg[0].y)
            for (let i = 1; i < sg.length; i++) ctx.lineTo(sg[i].x, sg[i].y)
          }
        }
        if (down) {
          trace()
          ctx.strokeStyle = "rgba(205,217,210,.3)"
          ctx.globalAlpha = 0.58
          ctx.lineWidth = 0.85
          ctx.setLineDash([3, 5])
          ctx.stroke()
          ctx.setLineDash([])
          ctx.globalAlpha = 1
          continue
        }
        // 光晕层：更宽更淡，lighter 叠加。
        ctx.save()
        if (pal.additive) ctx.globalCompositeOperation = "lighter"
        trace()
        ctx.strokeStyle = rgba(color, active ? (pal.additive ? 0.16 : 0.14) : pal.additive ? 0.07 : 0.06)
        ctx.lineWidth = active ? 6 : 4
        ctx.lineCap = "round"
        ctx.stroke()
        ctx.restore()
        // 主线：两端淡、中段亮的渐变描边。
        const ends = arcEnds(pts)
        if (!ends) continue
        const grad = ctx.createLinearGradient(ends.first.x, ends.first.y, ends.last.x, ends.last.y)
        const peak = active ? 0.95 : 0.62
        grad.addColorStop(0, rgba(color, peak * 0.35))
        grad.addColorStop(0.5, rgba(color, peak))
        grad.addColorStop(1, rgba(color, peak * 0.35))
        trace()
        ctx.strokeStyle = grad
        ctx.lineWidth = active ? 1.5 : 0.85
        ctx.stroke()
        if (playing) {
          for (const offset of [0, 0.49]) {
            const head = (now * 0.00011 + offset) % 1
            for (let k = 5; k >= 1; k--) {
              const t = head - k * 0.012
              if (t < 0) continue
              const p = at(t)
              if (p.z < 0) continue
              ctx.fillStyle = rgba(color, 0.5 * (1 - k / 6))
              ctx.beginPath()
              ctx.arc(p.x, p.y, 2.2 * (1 - k / 7), 0, Math.PI * 2)
              ctx.fill()
            }
            const p = at(head)
            if (p.z < 0) continue
            ctx.fillStyle = color
            ctx.shadowColor = color
            ctx.shadowBlur = 9
            ctx.beginPath()
            ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2)
            ctx.fill()
            ctx.shadowBlur = 0
          }
        }
      }
      const states = cityStates(current.links)
      const ringRGB = pal.dark ? pal.nodeRing : pal.ring
      hit.current = []
      const cities = current.cities
        .map((c) => ({ city: c, p: point(c.lat, c.lon) }))
        .filter((x) => x.p.z > 0)
        .sort((a, b) => b.p.z - a.p.z)
      // 手机宽度：标签相对地球太大，默认只显示城市名，选中时才展开网速。
      const compact = width < 560
      labels.begin()
      for (const { city: c, p } of cities) {
        const selected = c.name === current.selected
        const st = states.get(c.name)
        const downOnly = st === "down"
        const color = c.visitor ? "#ffe9a8" : c.online && !downOnly ? pal.nodeCore : pal.nodeOffline
        const fade = Math.min(1, p.z * 3 + 0.15)
        // 发光圆点；仅 active 的节点带向外扩散并渐隐的光圈，standby 静态，down 灰。
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, selected ? 18 : 13)
        glow.addColorStop(0, `rgba(${pal.nodeGlow},${downOnly ? 0.1 : 0.42 * fade})`)
        glow.addColorStop(1, `rgba(${pal.nodeGlow},0)`)
        ctx.fillStyle = glow
        ctx.beginPath()
        ctx.arc(p.x, p.y, selected ? 18 : 13, 0, Math.PI * 2)
        ctx.fill()
        if (st === "active" && playing) {
          for (let i = 0; i < RING_COUNT; i++) {
            const r = ringState(now, i)
            ctx.strokeStyle = `rgba(${ringRGB},${(r.alpha * fade).toFixed(3)})`
            ctx.lineWidth = 1.2
            ctx.beginPath()
            ctx.arc(p.x, p.y, r.radius, 0, Math.PI * 2)
            ctx.stroke()
          }
        }
        ctx.strokeStyle = selected ? (pal.dark ? "#fff" : "#0a6e50") : `rgba(${ringRGB},.6)`
        ctx.lineWidth = selected ? 1.4 : 1
        ctx.beginPath()
        ctx.arc(p.x, p.y, selected ? 8 : 5.5, 0, Math.PI * 2)
        ctx.stroke()
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(p.x, p.y, selected ? 3.8 : 2.8, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = pal.nodeStroke
        ctx.lineWidth = 1.4
        ctx.stroke()
        hit.current.push({ x: p.x, y: p.y, name: c.name })
        labels.add(c, p.x, p.y, selected, compact)
      }
      labels.draw({ w: width, h: height }, pal, current.selected, hover.current)
    }

    const loop = createRenderLoop({
      raf: (cb) => requestAnimationFrame(cb),
      caf: (id) => cancelAnimationFrame(id),
      render,
      playing: () => rotateRef.current,
      canRun: () => visible && !document.hidden,
      onError: (e) => console.error("[FleetGlobe] draw failed", e),
    })
    invalidate.current = loop.invalidate
    // 页面不可见或滚出视口时停止动画循环，回来后恢复。
    const start = () => {
      previous = 0
      loop.start()
    }
    const io = new IntersectionObserver((entries) => {
      visible = entries.some((e) => e.isIntersecting)
      if (visible) start()
    })
    io.observe(container)
    document.addEventListener("visibilitychange", start)
    // Ctrl/⌘ + 滚轮（含触控板双指捏合）缩放；普通滚轮仍然滚动页面。
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      zoomBy(Math.exp(-Math.max(-60, Math.min(60, e.deltaY)) * 0.01))
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    start()
    return () => {
      loop.stop()
      invalidate.current = () => {}
      observer.disconnect()
      io.disconnect()
      document.removeEventListener("visibilitychange", start)
      el.removeEventListener("wheel", onWheel)
    }
  }, [world, zoomBy])

  const nearest = (e: React.PointerEvent<HTMLCanvasElement> | React.MouseEvent<HTMLCanvasElement>) => {
    const rc = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rc.left
    const y = e.clientY - rc.top
    const n = hit.current.map((q) => ({ ...q, d: Math.hypot(x - q.x, y - q.y) })).sort((a, b) => a.d - b.d)[0]
    return { x, y, name: n && n.d < HIT_RADIUS ? n.name : "" }
  }
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    invalidate.current()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { active: true, x: e.clientX, y: e.clientY, moved: false }
    camera.current.lastInteraction = performance.now()
  }
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    invalidate.current()
    const d = drag.current
    if (!d.active) {
      const name = nearest(e).name
      hover.current = name
      e.currentTarget.style.cursor = name ? "pointer" : ""
      return
    }
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (Math.abs(dx) + Math.abs(dy) > 2 && !d.moved) {
      d.moved = true
      manual()
    }
    if (d.moved) {
      // 放大后每像素对应的角度更小，拖动才跟手；缩放不超过 1 时与原来一致。
      const scale = 1 / Math.max(1, camera.current.zoom)
      camera.current.lon -= dx * 0.25 * scale
      camera.current.lat = clampGlobeLat(camera.current.lat + dy * 0.2 * scale)
    }
    d.x = e.clientX
    d.y = e.clientY
    camera.current.lastInteraction = performance.now()
  }
  const up = (e: React.PointerEvent<HTMLCanvasElement>) => {
    invalidate.current()
    const d = drag.current
    d.active = false
    camera.current.lastInteraction = performance.now()
    if (d.moved) return
    const name = nearest(e).name
    if (name) latest.current.onSelect(name)
  }
  // 双击：把点击处转到画面中央并放大 1.8 倍（点在球外则忽略）。
  const doubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = nearest(e)
    const { width, height } = size.current
    const cam = camera.current
    const radius = globeRadius(width, height, cam.zoom)
    const target = orthoInverse((x - width * 0.5) / radius, (height * 0.49 - y) / radius, cam.lon, cam.lat)
    if (!target) return
    manual()
    flyTo({ lon: target.lon, lat: target.lat, zoom: cam.zoom * 1.8 })
  }
  const onKey = (e: React.KeyboardEvent<HTMLCanvasElement>) => {
    const cam = camera.current
    if (e.key === "ArrowLeft") cam.lon -= 8
    else if (e.key === "ArrowRight") cam.lon += 8
    else if (e.key === "ArrowUp") cam.lat = clampGlobeLat(cam.lat + 8)
    else if (e.key === "ArrowDown") cam.lat = clampGlobeLat(cam.lat - 8)
    else if (e.key === "+" || e.key === "=") zoomBy(1.3)
    else if (e.key === "-") zoomBy(1 / 1.3)
    else if (e.key === "Home") goRegion("world")
    else return
    e.preventDefault()
    if (e.key.startsWith("Arrow")) manual()
    invalidate.current()
  }

  return (
    <>
      <div className="map-bar">
        <RegionChips regions={regions} active={region} onPick={goRegion} />
        <span className="bar-hint">拖动旋转 · Ctrl/⌘ + 滚轮缩放 · 双击放大</span>
      </div>
      <div className="globe-stage" ref={wrap}>
        <div className="map-caption" ref={caption}>
          <span className="tiny-tag">GLOBAL NETWORK</span>
          <h2>每个节点，都在这里。</h2>
          <p>拖动地球，探索你的连接。</p>
        </div>
        <canvas
          ref={canvas}
          aria-label="可拖动的节点地球仪，方向键旋转，加减号缩放，Home 复位"
          tabIndex={0}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerLeave={() => {
            hover.current = ""
            invalidate.current()
          }}
          onPointerCancel={() => {
            drag.current.active = false
          }}
          onDoubleClick={doubleClick}
          onKeyDown={onKey}
        />
        <div className="map-coordinates">
          CITY-LEVEL POSITIONS <span>城市级示意坐标</span>
        </div>
        <div className="globe-controls">
          <button onClick={() => zoomBy(1.3)} aria-label="放大" title="放大（也可 Ctrl/⌘ + 滚轮、双击地球）">
            <Plus size={17} />
          </button>
          <button onClick={() => zoomBy(1 / 1.3)} aria-label="缩小" title="缩小（也可 Ctrl/⌘ + 滚轮）">
            <Minus size={17} />
          </button>
          <i />
          <button onClick={() => goRegion("world")} aria-label="复位" title="回到全球视图">
            <RotateCcw size={16} />
          </button>
          <button onClick={() => setRotating(!rotating)} aria-label={rotating ? "暂停旋转" : "自动旋转"} title={rotating ? "动画开启：点击暂停" : "动画关闭：点击播放"}>
            {rotating ? <Pause size={15} /> : <Play size={15} />}
          </button>
        </div>
        <div className="map-note">
          <Move size={13} /> 拖动旋转 <span>·</span> 点击城市高亮
        </div>
      </div>
    </>
  )
}
