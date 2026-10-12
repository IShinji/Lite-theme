import { useStatus } from "@/hooks/use-status"
import TrafficSpeedTooltip, { TrafficHoverDots } from "@/components/TrafficSpeedTooltip"
import { formatBytes, formatClockTime, formatSpeed, splitFormattedMeasure } from "@/lib/format"
import { fetchAccount } from "@/lib/lite-api"
import { homeTrafficWindowMs, recordHomeTraffic, type TrafficSample } from "@/lib/live-traffic"
import { resourceUsageTone } from "@/lib/meter-tone"
import { dualSeriesDomain, seriesPath } from "@/lib/sparkline"
import { RESOURCE_SWATCH } from "@/lib/theme-tokens"
import { readShowMobileHomeOverview } from "@/lib/theme-config"
import { trafficHoverIndex } from "@/lib/traffic-hover"
import { cn } from "@/lib/utils"
import { useQuery } from "@tanstack/react-query"
import { useId, useMemo, useState, type MouseEvent } from "react"
import { useTranslation } from "react-i18next"

type ServerOverviewProps = {
  online: number
  offline: number
  total: number
  up: number
  down: number
  upSpeed: number
  downSpeed: number
  now?: number
  servers: Array<{ country_code?: string; online: boolean; cpu?: number; mem?: number; tcp?: number; udp?: number; cpu_cores?: number; mem_total?: number; mem_used?: number; disk_total?: number; disk_used?: number }>
}

function formatClock(value: number) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ""
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
}

function greetingKey(now?: number) {
  const hour = new Date(now && Number.isFinite(now) ? now : Date.now()).getHours()
  if (hour < 9) return "home.greetMorning"
  if (hour < 11) return "home.greetForenoon"
  if (hour < 13) return "home.greetNoon"
  if (hour < 18) return "home.greetAfternoon"
  return "home.greetEvening"
}

function resourceFill(percent: number, swatch: string) {
  const tone = resourceUsageTone(percent)
  if (tone === "amber") return "var(--card-amber, #F0A632)"
  if (tone === "coral") return "var(--card-danger, #FF5630)"
  if (tone === "empty") return "transparent"
  return swatch
}

function Measure({ text, className }: { text: string; className?: string }) {
  const parts = splitFormattedMeasure(text)
  return (
    <strong className={cn("lite-home-measure", className)}>
      {parts.value}
      {parts.unit ? <small>{parts.unit}</small> : null}
    </strong>
  )
}

function DualTrafficChart({ samples, height }: { samples: TrafficSample[]; height: number }) {
  const uid = useId().replace(/:/g, "")
  const upFill = `lite-home-up-${uid}`
  const downFill = `lite-home-down-${uid}`
  const width = 652
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const up = samples.map((sample) => sample.up)
  const down = samples.map((sample) => sample.down)
  const domain = dualSeriesDomain(up, down)
  const upPath = seriesPath(up, width, height, 8, 8, domain)
  const downPath = seriesPath(down, width, height, 8, 8, domain)
  const start = samples[0] ? formatClock(samples[0].t) : ""
  const mid = samples.length ? formatClock(samples[Math.floor((samples.length - 1) / 2)]!.t) : ""
  const end = samples.at(-1) ? formatClock(samples.at(-1)!.t) : ""
  const hover = hoverIndex !== null ? samples[hoverIndex] : null
  const hoverUp = hoverIndex !== null ? upPath.points[hoverIndex] : null
  const hoverDown = hoverIndex !== null ? downPath.points[hoverIndex] : null
  const onMove = (event: MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    setHoverIndex(trafficHoverIndex(event.clientX, rect.left, rect.width, samples.length))
  }
  return (
    <div className="lite-home-chart">
      <div className="lite-home-chart__plot" onMouseMove={onMove} onMouseLeave={() => setHoverIndex(null)}>
        <svg className="lite-home-chart__svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
          <path d={`M0 ${height * 0.12}H${width} M0 ${height * 0.4}H${width} M0 ${height * 0.68}H${width}`} className="lite-home-chart__grid" />
          {upPath.area ? <path d={upPath.area} fill={`url(#${upFill})`} /> : null}
          {downPath.area ? <path d={downPath.area} fill={`url(#${downFill})`} /> : null}
          {upPath.line ? <path d={upPath.line} className="lite-home-chart__up" /> : null}
          {downPath.line ? <path d={downPath.line} className="lite-home-chart__down" /> : null}
          {hover && hoverUp ? (
            <line x1={hoverUp.x} x2={hoverUp.x} y1="8" y2={height - 8} className="lite-traffic-tip__rule" />
          ) : null}
          <defs>
            <linearGradient id={upFill} x1="0" y1="0" x2="0" y2="1">
              <stop stopColor="#078dee" stopOpacity=".13" />
              <stop offset="1" stopColor="#078dee" stopOpacity="0" />
            </linearGradient>
            <linearGradient id={downFill} x1="0" y1="0" x2="0" y2="1">
              <stop stopColor="#21b96b" stopOpacity=".1" />
              <stop offset="1" stopColor="#21b96b" stopOpacity="0" />
            </linearGradient>
          </defs>
        </svg>
        {hover && hoverUp && hoverDown ? (
          <>
            <TrafficHoverDots up={hoverUp} down={hoverDown} width={width} height={height} />
            <TrafficSpeedTooltip
              time={formatClockTime(hover.t)}
              up={formatSpeed(hover.up)}
              down={formatSpeed(hover.down)}
              index={hoverIndex ?? 0}
              count={samples.length}
            />
          </>
        ) : null}
      </div>
      <div className="lite-home-chart__times">
        <span>{start}</span>
        <span>{mid}</span>
        <span>{end}</span>
      </div>
    </div>
  )
}

export default function ServerOverview({ online, offline, total, up, down, upSpeed, downSpeed, now, servers }: ServerOverviewProps) {
  const { t } = useTranslation()
  const { status, setStatus } = useStatus()
  const { data: account } = useQuery({
    queryKey: ["me"],
    queryFn: fetchAccount,
    refetchOnWindowFocus: true,
    staleTime: 15_000,
  })
  const username = account?.logged_in ? account.username.trim() : ""
  const showMobileOverview = readShowMobileHomeOverview()
  const availability = total > 0 ? Math.round((online / total) * 1000) / 10 : null
  const trafficSamples = useMemo(() => recordHomeTraffic(upSpeed, downSpeed, now), [downSpeed, now, upSpeed])
  const windowMs = homeTrafficWindowMs(trafficSamples)
  const windowLabel = windowMs >= 15_000
    ? windowMs < 90_000
      ? t("serverOverview.windowSeconds", { count: Math.max(1, Math.round(windowMs / 1000)) })
      : t("serverOverview.windowMinutes", { count: Math.max(1, Math.round(windowMs / 60_000)) })
    : t("serverOverview.recentMinute")
  const onlineServers = servers.filter((server) => server.online)
  const totalCores = onlineServers.reduce((sum, server) => sum + (Number(server.cpu_cores) || 0), 0)
  const usedCores = onlineServers.reduce((sum, server) => sum + ((Number(server.cpu) || 0) / 100) * (Number(server.cpu_cores) || 0), 0)
  const cpuPercent = totalCores > 0 ? (usedCores / totalCores) * 100 : 0
  const totalMemory = onlineServers.reduce((sum, server) => sum + (Number(server.mem_total) || 0), 0)
  const usedMemory = onlineServers.reduce((sum, server) => sum + (Number(server.mem_used) || 0), 0)
  const memoryPercent = totalMemory > 0 ? (usedMemory / totalMemory) * 100 : 0
  const totalDisk = onlineServers.reduce((sum, server) => sum + (Number(server.disk_total) || 0), 0)
  const usedDisk = onlineServers.reduce((sum, server) => sum + (Number(server.disk_used) || 0), 0)
  const diskPercent = totalDisk > 0 ? (usedDisk / totalDisk) * 100 : 0
  const tcp = onlineServers.reduce((sum, server) => sum + (server.tcp || 0), 0)
  const udp = onlineServers.reduce((sum, server) => sum + (server.udp || 0), 0)
  const connections = tcp + udp
  const liveSpeed = formatSpeed(upSpeed + downSpeed)
  const upSpeedText = formatSpeed(upSpeed)
  const downSpeedText = formatSpeed(downSpeed)
  const greeting = t(greetingKey(now))
  const statusLabel = total === 0
    ? t("serverOverview.noServers")
    : online === 0
      ? t("serverOverview.allOffline")
      : offline === 0
        ? t("serverOverview.allOnline")
        : t("serverOverview.someOffline")
  const statusTone = total === 0 ? "muted" : online === 0 ? "warn" : offline === 0 ? "ok" : "warn"

  const filterOnline = () => setStatus(status === "online" ? "all" : "online")
  const filterOffline = () => {
    if (offline <= 0) return
    setStatus(status === "offline" ? "all" : "offline")
  }

  return (
    <section aria-label={t("overview")} className={cn("lite-home-overview", showMobileOverview && "lite-home-overview--mobile-open")}>
      <header className="lite-home-overview__mobile-head">
        <div className="lite-home-overview__welcome">
          <h1>{t("home.title")}</h1>
          <span className={cn("lite-home-overview__status", `lite-home-overview__status--${statusTone}`)}>
            <i />
            {statusLabel}
          </span>
        </div>
        <div className="lite-home-overview__context">
          <p className="lite-home-overview__mobile-greet">
            <span>{greeting}{username ? t("home.greetComma") : ""}</span>
            {username ? <strong className="lite-home-greeting-name" title={username}>{username}</strong> : null}
          </p>
          <div className="lite-home-overview__counts">
            <button type="button" onClick={filterOnline}>
              {t("serverOverview.onlineLabel")} <b>{online}</b>
            </button>
            <i />
            <button type="button" onClick={filterOffline} disabled={offline <= 0}>
              {t("serverOverview.offlineLabel")} <b>{offline}</b>
            </button>
          </div>
        </div>
      </header>

      <header className="lite-home-overview__desk-head">
        <div className="lite-home-overview__title">
          <h1>{t("home.title")}</h1>
          <p>
            {greeting}{username ? t("home.greetComma") : ""}
            {username ? <strong className="lite-home-greeting-name" title={username}>{username}</strong> : null}
          </p>
        </div>
        <div className="lite-home-overview__health">
          <span className={cn("lite-home-overview__status", `lite-home-overview__status--${statusTone}`)}>
            <i />
            {statusLabel}
          </span>
          <div className="lite-home-overview__numbers">
            <button type="button" onClick={filterOnline}>{t("serverOverview.onlineLabel")}<b>{online}</b></button>
            <button type="button" onClick={filterOffline} disabled={offline <= 0}>{t("serverOverview.offlineLabel")}<b>{offline}</b></button>
            <span className="lite-home-overview__rate">
              {t("serverOverview.onlineRate")}
              <b>{availability === null ? "--" : availability}<small>%</small></b>
            </span>
          </div>
        </div>
      </header>

      <div className="lite-home-overview__metrics" data-testid="home-mobile-metrics">
        <article>
          <span>{t("serverOverview.connectionCount")}</span>
          <Measure text={`${connections} ${t("serverOverview.connectionUnit")}`} />
          <p>TCP {tcp} · UDP {udp}</p>
        </article>
        <article>
          <span>{t("serverOverview.liveBandwidth")}</span>
          <Measure text={liveSpeed} />
          <p>{t("serverOverview.upPlusDown")}</p>
        </article>
        <article>
          <span>{t("serverOverview.totalTraffic")}</span>
          <Measure text={formatBytes(up + down)} />
          <p>{t("serverOverview.bothDirections")}</p>
        </article>
        <article>
          <span>{t("serverOverview.averageCpu")}</span>
          <Measure text={onlineServers.length ? `${cpuPercent.toFixed(1)} %` : "--"} />
          <p>{totalCores > 0 ? t("serverOverview.totalCores", { count: totalCores }) : "--"}</p>
          <div className="lite-home-overview__meter" aria-hidden="true"><i style={{ width: `${Math.min(100, cpuPercent)}%`, background: resourceFill(cpuPercent, RESOURCE_SWATCH.cpu) }} /></div>
        </article>
        <article>
          <span>{t("serverOverview.memoryUsage")}</span>
          <Measure text={onlineServers.length ? formatBytes(usedMemory) : "--"} />
          <p>{totalMemory > 0 ? t("serverOverview.usageShare", { percent: memoryPercent.toFixed(1), size: formatBytes(totalMemory) }) : "--"}</p>
          <div className="lite-home-overview__meter" aria-hidden="true"><i style={{ width: `${Math.min(100, memoryPercent)}%`, background: resourceFill(memoryPercent, RESOURCE_SWATCH.memory) }} /></div>
        </article>
        <article>
          <span>{t("serverOverview.storageUsage")}</span>
          <Measure text={onlineServers.length ? formatBytes(usedDisk) : "--"} />
          <p>{totalDisk > 0 ? t("serverOverview.usageShare", { percent: diskPercent.toFixed(1), size: formatBytes(totalDisk) }) : "--"}</p>
          <div className="lite-home-overview__meter" aria-hidden="true"><i style={{ width: `${Math.min(100, diskPercent)}%`, background: resourceFill(diskPercent, RESOURCE_SWATCH.storage) }} /></div>
        </article>
      </div>

      <section className="lite-home-overview__flow" aria-label={t("serverOverview.liveSpeed")} data-testid="home-mobile-flow">
        <header>
          <h2>{t("serverOverview.liveSpeed")}</h2>
          <span>{windowLabel}</span>
        </header>
        <div className="lite-home-overview__speeds">
          <div>
            <span className="lite-home-overview__dir lite-home-overview__dir--up"><i>↑</i> {t("serverOverview.uploadShort")}</span>
            <Measure text={upSpeedText} />
          </div>
          <div>
            <span className="lite-home-overview__dir lite-home-overview__dir--down"><i>↓</i> {t("serverOverview.downloadShort")}</span>
            <Measure text={downSpeedText} />
          </div>
        </div>
        <DualTrafficChart samples={trafficSamples} height={65} />
      </section>

      <div className="lite-home-overview__layout">
        <article className="lite-home-overview__live">
          <header>
            <span>{t("serverOverview.liveBandwidth")}</span>
            <span className="lite-home-overview__live-total"><Measure text={liveSpeed} /></span>
            <span className="lite-home-overview__period">{windowLabel}</span>
          </header>
          <div className="lite-home-overview__speeds lite-home-overview__speeds--desk">
            <div>
              <span className="lite-home-overview__dir lite-home-overview__dir--up"><i>↑</i>{t("serverOverview.uploadShort")}</span>
              <Measure text={upSpeedText} />
            </div>
            <div>
              <span className="lite-home-overview__dir lite-home-overview__dir--down"><i>↓</i>{t("serverOverview.downloadShort")}</span>
              <Measure text={downSpeedText} />
            </div>
          </div>
          <DualTrafficChart samples={trafficSamples} height={92} />
        </article>
        <article className="lite-home-overview__stats">
          <div className="lite-home-overview__primary">
            <div>
              <span>{t("serverOverview.connectionCount")}</span>
              <Measure text={`${connections} ${t("serverOverview.connectionUnit")}`} />
              <p>TCP {tcp} · UDP {udp}</p>
            </div>
            <div>
              <span>{t("serverOverview.totalTraffic")}</span>
              <Measure text={formatBytes(up + down)} />
              <p>{t("serverOverview.uploadShort")} {formatBytes(up)} · {t("serverOverview.downloadShort")} {formatBytes(down)}</p>
            </div>
          </div>
          <div className="lite-home-overview__resources">
            <div>
              <span>{t("serverOverview.averageCpu")}</span>
              <Measure text={onlineServers.length ? `${cpuPercent.toFixed(1)} %` : "--"} />
              <p>{totalCores > 0 ? t("serverOverview.totalCores", { count: totalCores }) : "--"}</p>
              <div className="lite-home-overview__meter" aria-hidden="true"><i style={{ width: `${Math.min(100, cpuPercent)}%`, background: resourceFill(cpuPercent, RESOURCE_SWATCH.cpu) }} /></div>
            </div>
            <div>
              <span>{t("serverOverview.memoryUsage")}</span>
              <Measure text={onlineServers.length ? formatBytes(usedMemory) : "--"} />
              <p>{totalMemory > 0 ? t("serverOverview.totalMemory", { size: formatBytes(totalMemory), percent: memoryPercent.toFixed(1) }) : "--"}</p>
              <div className="lite-home-overview__meter" aria-hidden="true"><i style={{ width: `${Math.min(100, memoryPercent)}%`, background: resourceFill(memoryPercent, RESOURCE_SWATCH.memory) }} /></div>
            </div>
            <div>
              <span>{t("serverOverview.storageUsage")}</span>
              <Measure text={onlineServers.length ? formatBytes(usedDisk) : "--"} />
              <p>{totalDisk > 0 ? t("serverOverview.totalDisk", { size: formatBytes(totalDisk), percent: diskPercent.toFixed(1) }) : "--"}</p>
              <div className="lite-home-overview__meter" aria-hidden="true"><i style={{ width: `${Math.min(100, diskPercent)}%`, background: resourceFill(diskPercent, RESOURCE_SWATCH.storage) }} /></div>
            </div>
          </div>
        </article>
      </div>
    </section>
  )
}
