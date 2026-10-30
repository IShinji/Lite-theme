import { globeMarkers, globeVector, type GlobeMarker, type GlobeNode } from "@/lib/globe-geo"
import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

const RAD = Math.PI / 180
const HOME_VIEW = { lon: 100, lat: 25, zoom: 1 }

type Palette = { sphereA: string; sphereB: string; rim: string; grid: string; land: (alpha: number) => string; online: string; offline: string; ring: string; text: string }

const LIGHT: Palette = {
  sphereA: "#e8f1fb",
  sphereB: "#c3d6ea",
  rim: "rgba(70,100,140,.35)",
  grid: "rgba(70,100,140,.14)",
  land: (a) => `rgba(32,84,150,${a})`,
  online: "#14a06b",
  offline: "#e0503a",
  ring: "rgba(20,160,107,.45)",
  text: "#1c252e",
}
const DARK: Palette = {
  sphereA: "#1d2c40",
  sphereB: "#101a27",
  rim: "rgba(160,190,225,.35)",
  grid: "rgba(160,190,225,.12)",
  land: (a) => `rgba(150,195,245,${a})`,
  online: "#3ddc9a",
  offline: "#ff7a63",
  ring: "rgba(61,220,154,.5)",
  text: "#ffffff",
}

export default function FleetGlobe({ nodes }: { nodes: GlobeNode[] }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(true)
  const markers = useMemo(() => globeMarkers(nodes), [nodes])
  const markersRef = useRef<GlobeMarker[]>(markers)
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const redrawRef = useRef<() => void>(() => {})
  const cam = useRef({ ...HOME_VIEW })
  const drag = useRef({ active: false, x: 0, y: 0 })
  const [land, setLand] = useState<number[][]>([])

  useEffect(() => {
    markersRef.current = markers
    redrawRef.current()
  }, [markers])

  useEffect(() => {
    if (!open || land.length > 0) return
    let alive = true
    import("@/data/land-dots.json")
      .then((mod) => {
        if (alive) setLand(mod.default as number[][])
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [open, land.length])

  useEffect(() => {
    const el = canvasRef.current
    const wrap = wrapRef.current
    const ctx = el?.getContext("2d")
    if (!open || !el || !wrap || !ctx) return
    let width = 0
    let height = 0
    let frame = 0
    let previous = 0
    let inView = true
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)")

    const resize = () => {
      width = wrap.clientWidth
      height = wrap.clientHeight
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      el.width = Math.max(1, Math.round(width * dpr))
      el.height = Math.max(1, Math.round(height * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      redrawRef.current()
    }

    const draw = (now: number) => {
      const dt = previous ? Math.min(now - previous, 40) : 16
      previous = now
      if (!motion.matches && !drag.current.active) cam.current.lon += dt * 0.004
      const palette = document.documentElement.classList.contains("dark") ? DARK : LIGHT
      const radius = Math.min(width * 0.42, height * 0.46) * cam.current.zoom
      const cx = width / 2
      const cy = height / 2
      const yaw = cam.current.lon * RAD
      const pitch = cam.current.lat * RAD
      const project = (v: number[]) => {
        const x = v[0] * Math.cos(yaw) - v[2] * Math.sin(yaw)
        const z0 = v[0] * Math.sin(yaw) + v[2] * Math.cos(yaw)
        const y = v[1] * Math.cos(pitch) - z0 * Math.sin(pitch)
        const z = v[1] * Math.sin(pitch) + z0 * Math.cos(pitch)
        return { x: cx + x * radius, y: cy - y * radius, z }
      }
      ctx.clearRect(0, 0, width, height)
      const fill = ctx.createRadialGradient(cx - radius * 0.35, cy - radius * 0.4, radius * 0.05, cx, cy, radius * 1.1)
      fill.addColorStop(0, palette.sphereA)
      fill.addColorStop(1, palette.sphereB)
      ctx.beginPath()
      ctx.arc(cx, cy, radius, 0, Math.PI * 2)
      ctx.fillStyle = fill
      ctx.fill()
      ctx.save()
      ctx.clip()
      ctx.lineWidth = 0.6
      ctx.strokeStyle = palette.grid
      const trace = (coords: Array<[number, number]>) => {
        ctx.beginPath()
        let pen = false
        for (const [lat, lon] of coords) {
          const p = project(globeVector(lat, lon))
          if (p.z < 0) {
            pen = false
            continue
          }
          if (pen) ctx.lineTo(p.x, p.y)
          else {
            ctx.moveTo(p.x, p.y)
            pen = true
          }
        }
        ctx.stroke()
      }
      for (let lat = -60; lat <= 60; lat += 30) {
        const line: Array<[number, number]> = []
        for (let lon = -180; lon <= 180; lon += 6) line.push([lat, lon])
        trace(line)
      }
      for (let lon = -180; lon < 180; lon += 30) {
        const line: Array<[number, number]> = []
        for (let lat = -90; lat <= 90; lat += 6) line.push([lat, lon])
        trace(line)
      }
      for (const [lon, lat] of land) {
        const p = project(globeVector(lat, lon))
        if (p.z < 0) continue
        ctx.fillStyle = palette.land(0.25 + p.z * 0.6)
        ctx.fillRect(p.x - 0.7, p.y - 0.7, 1.4, 1.4)
      }
      ctx.restore()
      ctx.beginPath()
      ctx.arc(cx, cy, radius, 0, Math.PI * 2)
      ctx.strokeStyle = palette.rim
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.font = "600 11px -apple-system, sans-serif"
      ctx.textAlign = "center"
      for (const marker of markersRef.current) {
        const p = project(globeVector(marker.lat, marker.lon))
        if (p.z <= 0.02) continue
        const color = marker.online > 0 ? palette.online : palette.offline
        ctx.beginPath()
        ctx.arc(p.x, p.y, 6, 0, Math.PI * 2)
        ctx.strokeStyle = marker.online > 0 ? palette.ring : palette.offline
        ctx.lineWidth = 1
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2)
        ctx.fillStyle = color
        ctx.fill()
        if (marker.total > 1) {
          ctx.fillStyle = palette.text
          ctx.fillText(String(marker.total), p.x, p.y - 10)
        }
      }
    }

    // 只在可见、在视口内、且没有减少动画偏好时持续渲染；其余情况按需画一帧。
    const active = () => !document.hidden && inView
    const loop = (now: number) => {
      frame = 0
      if (!active()) return
      draw(now)
      if (!motion.matches) frame = requestAnimationFrame(loop)
    }
    const kick = () => {
      if (frame || !active()) return
      previous = 0
      frame = requestAnimationFrame(loop)
    }
    redrawRef.current = kick

    const onVisibility = () => {
      if (document.hidden && frame) {
        cancelAnimationFrame(frame)
        frame = 0
      } else kick()
    }
    const observer = new IntersectionObserver((entries) => {
      inView = entries.some((entry) => entry.isIntersecting)
      if (!inView && frame) {
        cancelAnimationFrame(frame)
        frame = 0
      } else kick()
    })
    observer.observe(wrap)
    const resizer = new ResizeObserver(resize)
    resizer.observe(wrap)
    document.addEventListener("visibilitychange", onVisibility)
    motion.addEventListener("change", kick)
    resize()
    kick()
    return () => {
      cancelAnimationFrame(frame)
      frame = 0
      redrawRef.current = () => {}
      observer.disconnect()
      resizer.disconnect()
      document.removeEventListener("visibilitychange", onVisibility)
      motion.removeEventListener("change", kick)
    }
  }, [open, land])

  const onDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { active: true, x: event.clientX, y: event.clientY }
  }
  const onMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drag.current.active) return
    cam.current.lon -= (event.clientX - drag.current.x) * 0.25
    cam.current.lat = Math.max(-65, Math.min(65, cam.current.lat + (event.clientY - drag.current.y) * 0.2))
    drag.current.x = event.clientX
    drag.current.y = event.clientY
    redrawRef.current()
  }
  const onUp = () => {
    drag.current.active = false
    redrawRef.current()
  }
  const onKey = (event: React.KeyboardEvent<HTMLCanvasElement>) => {
    const c = cam.current
    if (event.key === "ArrowLeft") c.lon -= 8
    else if (event.key === "ArrowRight") c.lon += 8
    else if (event.key === "ArrowUp") c.lat = Math.min(65, c.lat + 8)
    else if (event.key === "ArrowDown") c.lat = Math.max(-65, c.lat - 8)
    else if (event.key === "Home") Object.assign(c, HOME_VIEW)
    else return
    event.preventDefault()
    redrawRef.current()
  }
  const onWheelZoom = (delta: number) => {
    cam.current.zoom = Math.max(0.7, Math.min(1.4, cam.current.zoom + delta))
    redrawRef.current()
  }

  return (
    <section className="lite-home-globe mb-4 rounded-2xl border border-[var(--lite-line)] bg-[var(--lite-paper)]" aria-label={t("globe.title")}>
      <div className="flex items-center justify-between gap-3 px-4 py-2.5">
        <h2 className="m-0 text-sm font-semibold text-[var(--lite-ink)]">{t("globe.title")}</h2>
        <div className="flex items-center gap-2 text-xs text-[var(--lite-muted)]">
          {open ? (
            <>
              <button type="button" aria-label={t("globe.zoomIn")} onClick={() => onWheelZoom(0.1)}>+</button>
              <button type="button" aria-label={t("globe.zoomOut")} onClick={() => onWheelZoom(-0.1)}>-</button>
            </>
          ) : null}
          <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? t("globe.collapse") : t("globe.expand")}
          </button>
        </div>
      </div>
      {open ? (
        <div ref={wrapRef} className="relative h-[360px] w-full max-[967px]:h-[220px]">
          <canvas
            ref={canvasRef}
            className="block h-full w-full cursor-grab"
            style={{ touchAction: "pan-y" }}
            tabIndex={0}
            aria-label={t("globe.canvasLabel")}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onKeyDown={onKey}
          />
        </div>
      ) : null}
    </section>
  )
}
