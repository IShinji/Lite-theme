// 平面地图版节点星图：等距圆柱投影的 Canvas 2D，固定的世界图（和出版社的世界地图一样，左右不循环）。
// 数据与地球仪共用（节点、连线、速度、主题）。标签贴着各自的圆点放、不盖住别的点；放不下的只留圆点，悬停时浮出详情。
import { geoEquirectangular, geoPath } from "d3-geo"
import { Minus, Pause, Play, Plus, RotateCcw } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import RegionChips from "@/components/RegionChips"
import type { City, GlobeLink } from "@/lib/fleet-globe-data"
import { FLAT_HOME, WORLD_LAT_BOTTOM, WORLD_LAT_TOP, clampCamera, fitBounds, flatArc, flatLayerKey, flatProject, flatScale, regionsWithCities, zoomAt, type FlatCamera } from "@/lib/fleet-flatmap"
import { createLabelPainter } from "@/lib/fleet-label-canvas"
import { heatLevel, maxMachines, paintHeat } from "@/lib/fleet-heat"
import { dotHash } from "@/lib/fleet-globe-layout"
import { arcEnds, createRenderLoop, resolveMotion } from "@/lib/fleet-globe-loop"
import { RING_COUNT, cityStates, globePalette, kindColors, ringState, rgba, type Palette } from "@/lib/fleet-globe-style"
import { readGlobeMotion } from "@/lib/theme-config"
import { forEachLandDot, pickPitch } from "@/lib/world-dots"
import { loadWorld, type World } from "@/lib/world-geo"

type Props = { cities: City[]; links: GlobeLink[]; selected: string; onSelect: (city: string) => void; filter: string; dark: boolean; heat: boolean }

const HIT_RADIUS = 18

export default function FleetFlatMap(props: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const latest = useRef(props)
  const camera = useRef<FlatCamera>({ ...FLAT_HOME })
  const size = useRef({ width: 800, height: 400 })
  const drag = useRef({ active: false, x: 0, y: 0, moved: false })
  const hit = useRef<Array<{ x: number; y: number; name: string }>>([])
  const hover = useRef("")
  const flight = useRef(0)
  const invalidate = useRef<() => void>(() => {})
  const [playing, setPlaying] = useState(() => resolveMotion(readGlobeMotion(), window.matchMedia("(prefers-reduced-motion: reduce)").matches))
  const playRef = useRef(playing)
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
    playRef.current = playing
    invalidate.current()
  }, [playing])
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

  // 镜头操作只碰 ref 和稳定的 setState，所以都是稳定的回调，事件监听（滚轮要 passive:false，只能自己 addEventListener）可以放心引用。
  const apply = useCallback((next: FlatCamera) => {
    camera.current = clampCamera(next, size.current.width, size.current.height)
    invalidate.current()
  }, [])
  const manual = useCallback(() => {
    if (flight.current) cancelAnimationFrame(flight.current)
    flight.current = 0
    setRegion("")
  }, [])
  const zoomBy = useCallback(
    (factor: number, px?: number, py?: number) => {
      const { width, height } = size.current
      manual()
      apply(zoomAt(camera.current, factor, px ?? width / 2, py ?? height / 2, width, height))
    },
    [apply, manual],
  )
  const flyTo = useCallback(
    (target: FlatCamera) => {
      if (flight.current) cancelAnimationFrame(flight.current)
      flight.current = 0
      const from = camera.current
      const to = clampCamera(target, size.current.width, size.current.height)
      if (!playRef.current) {
        apply(to)
        return
      }
      const t0 = performance.now()
      const step = (now: number) => {
        const k = Math.min(1, (now - t0) / 420)
        const e = 1 - Math.pow(1 - k, 3)
        apply({ lon: from.lon + (to.lon - from.lon) * e, lat: from.lat + (to.lat - from.lat) * e, zoom: from.zoom * Math.pow(to.zoom / from.zoom, e) })
        flight.current = k < 1 ? requestAnimationFrame(step) : 0
      }
      flight.current = requestAnimationFrame(step)
    },
    [apply],
  )
  const goRegion = (key: string) => {
    setRegion(key)
    const box = regionsRef.current.find((r) => r.key === key)
    flyTo(box ? fitBounds(box, size.current.width, size.current.height) : FLAT_HOME)
  }

  useEffect(() => {
    const el = canvas.current
    const container = wrap.current
    if (!el || !container) return
    const context = el.getContext("2d")
    if (!context) return
    const ctx = context
    const layer = document.createElement("canvas")
    const lctx = layer.getContext("2d")
    let width = 800
    let height = 400
    let dpr = 1
    let visible = true
    let cacheKey = ""
    const labels = createLabelPainter(ctx)

    const resize = () => {
      width = container.clientWidth
      height = container.clientHeight
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      el.width = width * dpr
      el.height = height * dpr
      layer.width = el.width
      layer.height = el.height
      size.current = { width, height }
      camera.current = clampCamera(camera.current, width, height)
      cacheKey = ""
      invalidate.current()
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(container)

    // 静态层：世界范围、经纬网、点阵陆地。只在镜头、尺寸或主题变化时重画。
    const paintStatic = (c: CanvasRenderingContext2D, cam: FlatCamera, dark: boolean, pal: Palette) => {
      const P = (lat: number, lon: number) => flatProject(lat, lon, cam, width, height)
      const s = flatScale(width, height, cam.zoom)
      const x0 = P(0, -180).x
      const x1 = P(0, 180).x
      const top = P(WORLD_LAT_TOP, 0).y
      const bottom = P(WORLD_LAT_BOTTOM, 0).y
      c.setTransform(dpr, 0, 0, dpr, 0, 0)
      c.clearRect(0, 0, width, height)
      c.save()
      c.beginPath()
      c.rect(x0, top, x1 - x0, bottom - top)
      c.clip()
      c.fillStyle = dark ? "rgba(120,200,170,.04)" : "rgba(255,255,255,.42)"
      c.fillRect(x0, top, x1 - x0, bottom - top)
      c.strokeStyle = `rgba(${pal.grid},${pal.gridAlpha})`
      c.lineWidth = 0.6
      c.beginPath()
      for (let lat = -30; lat <= 60; lat += 30) {
        const y = P(lat, 0).y
        c.moveTo(x0, y)
        c.lineTo(x1, y)
      }
      for (let lon = -150; lon <= 150; lon += 30) {
        const x = P(0, lon).x
        c.moveTo(x, top)
        c.lineTo(x, bottom)
      }
      c.stroke()
      // 陆地：矢量底色 + 从陆地掩膜采样的细点阵 + 矢量海岸线（放大后再加国界）。点阵按屏幕间距均匀采样，放大时自动变密，海岸线越放越清楚。
      if (world) {
        const detail = s >= 7 ? world.fine : world.coarse
        const path = geoPath(
          geoEquirectangular()
            .scale((s * 180) / Math.PI)
            .center([cam.lon, cam.lat])
            .translate([width / 2, height / 2])
            .precision(0.5),
          c,
        )
        c.fillStyle = `rgba(${pal.land},${dark ? 0.1 : 0.13})`
        c.beginPath()
        path(detail.land)
        c.fill()
        const pitch = pickPitch(s)
        const r = Math.min(1.9, Math.max(0.7, pitch * s * 0.27))
        const buckets: number[][] = [[], []]
        const win = {
          lonMin: cam.lon - width / 2 / s - pitch,
          lonMax: cam.lon + width / 2 / s + pitch,
          latMin: cam.lat - height / 2 / s - pitch,
          latMax: cam.lat + height / 2 / s + pitch,
        }
        forEachLandDot(world.mask, pitch, win, false, (lon, lat) => {
          const p = P(lat, lon)
          if (p.x < x0 - 4 || p.x > x1 + 4 || p.y < top - 4 || p.y > bottom + 4) return
          buckets[dotHash(lon, lat) > 0.5 ? 1 : 0].push(p.x, p.y)
        })
        for (let tint = 0; tint < 2; tint++) {
          c.fillStyle = `rgba(${pal.land},${tint ? 0.85 : 0.55})`
          c.beginPath()
          const list = buckets[tint]
          for (let i = 0; i < list.length; i += 2) {
            c.moveTo(list[i] + r, list[i + 1])
            c.arc(list[i], list[i + 1], r, 0, Math.PI * 2)
          }
          c.fill()
        }
        c.strokeStyle = `rgba(${pal.land},${dark ? 0.45 : 0.5})`
        c.lineWidth = 0.7
        c.beginPath()
        path(detail.coast)
        c.stroke()
        if (s >= 7) {
          c.strokeStyle = `rgba(${pal.land},${dark ? 0.22 : 0.26})`
          c.lineWidth = 0.5
          c.beginPath()
          path(detail.borders)
          c.stroke()
        }
      }
      c.restore()
      c.strokeStyle = `rgba(${pal.grid},${Math.min(1, pal.gridAlpha * 2)})`
      c.lineWidth = 1
      c.strokeRect(x0, top, x1 - x0, bottom - top)
    }

    const render = (now: number) => {
      if (width < 10 || height < 10) return
      const animate = playRef.current
      const cam = camera.current
      const current = latest.current
      const pal = globePalette(current.dark)
      const colors = kindColors(current.dark)
      const P = (lat: number, lon: number) => flatProject(lat, lon, cam, width, height)

      const layerKey = flatLayerKey(cam, width, height, current.dark, world ? 1 : 0)
      if (layerKey !== cacheKey && lctx) {
        paintStatic(lctx, cam, current.dark, pal)
        cacheKey = layerKey
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, el.width, el.height)
      ctx.drawImage(layer, 0, 0)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      // 连线：只画在世界范围内。
      const x0 = P(0, -180).x
      const x1 = P(0, 180).x
      const top = P(WORLD_LAT_TOP, 0).y
      const bottom = P(WORLD_LAT_BOTTOM, 0).y
      ctx.save()
      ctx.beginPath()
      ctx.rect(x0, top, x1 - x0, bottom - top)
      ctx.clip()
      if (current.heat) {
        const most = maxMachines(current.cities)
        const unit = Math.max(14, Math.min(70, (P(0, 10).x - P(0, 0).x) * 0.32))
        for (const c of current.cities) {
          const hp = P(c.lat, c.lon)
          paintHeat(ctx, hp.x, hp.y, heatLevel(c.nodes.length, most), unit, current.dark)
        }
      }
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
        const arc = flatArc(a, b, cam, width, height)
        const pts = arc.points()
        const color = colors[link.kind] || colors.exit
        const down = link.state === "down"
        const active = link.state === "active"
        const trace = () => {
          ctx.beginPath()
          ctx.moveTo(pts[0].x, pts[0].y)
          for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
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
        ctx.save()
        if (pal.additive) ctx.globalCompositeOperation = "lighter"
        trace()
        ctx.strokeStyle = rgba(color, active ? (pal.additive ? 0.16 : 0.14) : pal.additive ? 0.07 : 0.06)
        ctx.lineWidth = active ? 6 : 4
        ctx.lineCap = "round"
        ctx.stroke()
        ctx.restore()
        const ends = arcEnds([pts])
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
        if (animate) {
          for (const offset of [0, 0.49]) {
            const head = (now * 0.00011 + offset) % 1
            for (let k = 5; k >= 1; k--) {
              const t = head - k * 0.012
              if (t < 0) continue
              const p = arc.at(t)
              ctx.fillStyle = rgba(color, 0.5 * (1 - k / 6))
              ctx.beginPath()
              ctx.arc(p.x, p.y, 2.2 * (1 - k / 7), 0, Math.PI * 2)
              ctx.fill()
            }
            const p = arc.at(head)
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
      ctx.restore()

      // 节点
      const states = cityStates(current.links)
      const ringRGB = pal.dark ? pal.nodeRing : pal.ring
      hit.current = []
      // 手机宽度：标签相对地图太大，默认只显示城市名，选中或悬停时才展开网速。
      const compact = width < 560
      labels.begin()
      for (const c of current.cities) {
        const p = P(c.lat, c.lon)
        if (p.x < -20 || p.x > width + 20 || p.y < -20 || p.y > height + 20) continue
        const selected = c.name === current.selected
        const st = states.get(c.name)
        const downOnly = st === "down"
        const color = c.visitor ? "#ffe9a8" : c.online && !downOnly ? pal.nodeCore : pal.nodeOffline
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, selected ? 18 : 13)
        glow.addColorStop(0, `rgba(${pal.nodeGlow},${downOnly ? 0.1 : 0.42})`)
        glow.addColorStop(1, `rgba(${pal.nodeGlow},0)`)
        ctx.fillStyle = glow
        ctx.beginPath()
        ctx.arc(p.x, p.y, selected ? 18 : 13, 0, Math.PI * 2)
        ctx.fill()
        if (st === "active" && animate) {
          for (let i = 0; i < RING_COUNT; i++) {
            const rs = ringState(now, i)
            ctx.strokeStyle = `rgba(${ringRGB},${rs.alpha.toFixed(3)})`
            ctx.lineWidth = 1.2
            ctx.beginPath()
            ctx.arc(p.x, p.y, rs.radius, 0, Math.PI * 2)
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

      // 标签：贴着各自的圆点，不碰别的标签、不盖别的点；悬停浮出完整标签（共用 createLabelPainter）。
      labels.draw({ w: width, h: height }, pal, current.selected, hover.current)
    }

    const loop = createRenderLoop({
      raf: (cb) => requestAnimationFrame(cb),
      caf: (id) => cancelAnimationFrame(id),
      render,
      playing: () => playRef.current,
      canRun: () => visible && !document.hidden,
      onError: (e) => console.error("[FleetFlatMap] draw failed", e),
    })
    invalidate.current = loop.invalidate
    const start = () => loop.start()
    const io = new IntersectionObserver((entries) => {
      visible = entries.some((e) => e.isIntersecting)
      if (visible) start()
    })
    io.observe(container)
    document.addEventListener("visibilitychange", start)
    // Ctrl/⌘ + 滚轮（含触控板双指捏合）缩放到鼠标位置；普通滚轮仍然滚动页面。
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const rc = el.getBoundingClientRect()
      zoomBy(Math.exp(-Math.max(-60, Math.min(60, e.deltaY)) * 0.01), e.clientX - rc.left, e.clientY - rc.top)
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
  const pan = (dx: number, dy: number) => {
    const cam = camera.current
    const s = flatScale(size.current.width, size.current.height, cam.zoom)
    apply({ ...cam, lon: cam.lon - dx / s, lat: cam.lat + dy / s })
  }
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { active: true, x: e.clientX, y: e.clientY, moved: false }
  }
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current
    if (!d.active) {
      const name = nearest(e).name
      if (name !== hover.current) {
        hover.current = name
        e.currentTarget.style.cursor = name ? "pointer" : ""
        invalidate.current()
      }
      return
    }
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (Math.abs(dx) + Math.abs(dy) > 2 && !d.moved) {
      d.moved = true
      manual()
    }
    if (d.moved) pan(dx, dy)
    d.x = e.clientX
    d.y = e.clientY
  }
  const up = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current
    d.active = false
    if (d.moved) return
    const hitName = nearest(e).name
    if (hitName) latest.current.onSelect(hitName)
  }
  const doubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = nearest(e)
    manual()
    flyTo(zoomAt(camera.current, 2, x, y, size.current.width, size.current.height))
  }
  const onKey = (e: React.KeyboardEvent<HTMLCanvasElement>) => {
    const step = 40
    if (e.key === "ArrowLeft") pan(step, 0)
    else if (e.key === "ArrowRight") pan(-step, 0)
    else if (e.key === "ArrowUp") pan(0, step)
    else if (e.key === "ArrowDown") pan(0, -step)
    else if (e.key === "+" || e.key === "=") zoomBy(1.25)
    else if (e.key === "-") zoomBy(0.8)
    else if (e.key === "Home") goRegion("world")
    else return
    e.preventDefault()
  }

  return (
    <>
      <div className="map-bar">
        <RegionChips regions={regions} active={region} onPick={goRegion} />
        <div className="globe-controls">
          <button onClick={() => zoomBy(1.4)} aria-label="放大" title="放大（也可 Ctrl/⌘ + 滚轮、双击地图）">
            <Plus size={17} />
          </button>
          <button onClick={() => zoomBy(1 / 1.4)} aria-label="缩小" title="缩小（也可 Ctrl/⌘ + 滚轮）">
            <Minus size={17} />
          </button>
          <i />
          <button onClick={() => goRegion("world")} aria-label="复位" title="回到全球视图">
            <RotateCcw size={16} />
          </button>
          <button onClick={() => setPlaying(!playing)} aria-label={playing ? "暂停动画" : "播放动画"} title={playing ? "动画开启：点击暂停" : "动画关闭：点击播放"}>
            {playing ? <Pause size={15} /> : <Play size={15} />}
          </button>
        </div>
      </div>
      <div className="globe-stage flat-stage" ref={wrap}>
        <canvas
          ref={canvas}
          aria-label="节点平面地图：放大后可拖动，方向键平移，加减号缩放，Home 复位"
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
      </div>
    </>
  )
}
