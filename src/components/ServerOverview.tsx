import { useStatus } from "@/hooks/use-status"
import { formatBytes, formatSpeed } from "@/lib/format"
import { healthStatusDots } from "@/lib/health-dots"
import { homeTrafficWindowMs, recordHomeTraffic, type TrafficSample } from "@/lib/live-traffic"
import { seriesPath } from "@/lib/sparkline"
import { THEME } from "@/lib/theme-tokens"
import { readShowMobileHomeOverview } from "@/lib/theme-config"
import { cn } from "@/lib/utils"
import { ArrowUpDown, Cable, Cpu, Database, HardDrive, MemoryStick } from "lucide-react"
import { useMemo, type ReactNode } from "react"
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

const METRIC_TONE = {
  connections: "#4C8FD4",
  live: "#22C55E",
  traffic: "#7B6CC7",
  cpu: "#D4A04A",
  memory: "#8A74C8",
  disk: "#2F9BA8",
} as const

function QuickMetric({ label, value, unit, detail, tone, icon, onDetailClick, detailActive }: { label: string; value: string; unit?: string; detail: string; tone: string; icon: ReactNode; onDetailClick?: () => void; detailActive?: boolean }) {
  const detailClass = cn("block truncate text-left text-[11px]", onDetailClick ? "hover:text-[#078DEE]" : "", detailActive ? "font-medium text-[#078DEE]" : "text-[#919EAB]")
  return (
    <article className="flex h-full min-w-0 flex-col justify-between gap-2 rounded-[14px] border border-[var(--lite-line)] bg-[var(--lite-paper)] px-4 py-3.5 shadow-[0_1px_2px_rgba(28,37,46,0.03)] max-[967px]:gap-2.5 max-[967px]:px-3.5 max-[967px]:py-4">
      <span className="flex items-center gap-2 text-[11px] text-[#637381] dark:text-[#B8C4CC]">
        <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full" style={{ color: tone, background: `color-mix(in srgb, ${tone} var(--lite-tint), transparent)` }}>{icon}</span>
        {label}
      </span>
      <strong className="block truncate text-[22px] font-semibold leading-none tracking-tight tabular-nums text-[#1C252E] dark:text-white">{value}{unit ? <small className="ml-1 text-[11px] font-normal text-[#919EAB]">{unit}</small> : null}</strong>
      {onDetailClick ? (
        <button type="button" onClick={onDetailClick} className={detailClass}>{detail}</button>
      ) : (
        <span className={detailClass}>{detail}</span>
      )}
    </article>
  )
}

function TrafficMini({ samples, tone }: { samples: TrafficSample[]; tone: "up" | "down" }) {
  const { t } = useTranslation()
  const values = samples.map((sample) => (tone === "up" ? sample.up : sample.down))
  const path = seriesPath(values, 260, 66, 2, 0)
  const color = tone === "up" ? THEME.blue : THEME.green
  return (
    <div className="min-w-0 rounded-lg bg-[var(--lite-paper)] p-2.5">
      <div className="flex items-center justify-between gap-2 text-[11px]"><span className={tone === "up" ? "text-[#078DEE]" : "text-[#118D57]"}>{tone === "up" ? `↑ ${t("serverOverview.uploadShort")}` : `↓ ${t("serverOverview.downloadShort")}`}</span><b className="truncate tabular-nums" style={{ color }}>{formatSpeed(values.at(-1) || 0)}</b></div>
      <svg className="mt-1.5 block h-[58px] w-full" viewBox="0 0 260 66" preserveAspectRatio="none" aria-hidden="true"><path d="M0 16H260 M0 41H260 M0 65H260" fill="none" stroke="currentColor" strokeOpacity=".12" strokeDasharray="3 4" />{path.area ? <path d={path.area} fill={color} fillOpacity=".08" /> : null}{path.line ? <path d={path.line} fill="none" stroke={color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" /> : null}</svg>
      <div className="flex justify-between text-[10px] text-[#919EAB]"><span>{samples[0] ? formatClock(samples[0].t) : ""}</span><span>{samples.at(-1) ? formatClock(samples.at(-1)!.t) : ""}</span></div>
    </div>
  )
}

export default function ServerOverview({ online, offline, total, up, down, upSpeed, downSpeed, now, servers }: ServerOverviewProps) {
  const { t } = useTranslation()
  const { status, setStatus } = useStatus()
  const showMobileOverview = readShowMobileHomeOverview()
  const availability = total > 0 ? Math.round((online / total) * 1000) / 10 : 0
  const trafficSamples = useMemo(() => recordHomeTraffic(upSpeed, downSpeed, now), [downSpeed, now, upSpeed])
  const windowMs = homeTrafficWindowMs(trafficSamples)
  const windowLabel = windowMs >= 15_000
    ? windowMs < 90_000
      ? t("serverOverview.windowSeconds", { count: Math.max(1, Math.round(windowMs / 1000)) })
      : t("serverOverview.windowMinutes", { count: Math.max(1, Math.round(windowMs / 60_000)) })
    : null
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
  const filterOffline = () => setStatus(status === "offline" ? "all" : "offline")
  const tcp = onlineServers.reduce((sum, server) => sum + (server.tcp || 0), 0)
  const udp = onlineServers.reduce((sum, server) => sum + (server.udp || 0), 0)
  const connections = tcp + udp

  return (
    <section aria-label={t("overview")} className="rounded-[14px] border border-[var(--lite-line)] bg-[var(--lite-well)] p-[11px] max-[967px]:relative max-[967px]:mt-3 max-[967px]:overflow-visible max-[967px]:px-3 max-[967px]:pb-3 max-[967px]:pt-0">
      <div className="grid gap-[11px] min-[1151px]:grid-cols-[minmax(0,1.55fr)_minmax(390px,.95fr)] max-[1150px]:grid-cols-1 max-[967px]:gap-3">
        <div className="flex min-w-0 flex-col min-[1151px]:relative">
          <div className={cn("flex min-h-0 flex-1 flex-col justify-end max-[1150px]:flex-none", showMobileOverview ? "max-[967px]:order-2 max-[967px]:mt-4" : "max-[967px]:hidden")}>
            <div className="grid h-[65.6%] min-h-0 auto-rows-fr grid-cols-3 gap-[11px] max-[1150px]:h-auto max-[1150px]:auto-rows-auto max-[967px]:grid-cols-2 max-[967px]:gap-3.5">
              <QuickMetric label={t("serverOverview.connectionCount")} value={String(connections)} unit={t("serverOverview.connectionUnit")} detail={`${t("serverOverview.tcp")} ${tcp} · ${t("serverOverview.udp")} ${udp}`} tone={METRIC_TONE.connections} icon={<Cable className="size-3.5" strokeWidth={1.75} />} />
              <QuickMetric label={t("serverOverview.liveBandwidth")} value={formatSpeed(upSpeed + downSpeed)} detail={`↑ ${formatSpeed(upSpeed)} · ↓ ${formatSpeed(downSpeed)}`} tone={METRIC_TONE.live} icon={<ArrowUpDown className="size-3.5" strokeWidth={1.75} />} />
              <QuickMetric label={t("serverOverview.totalTraffic")} value={formatBytes(up + down)} detail={`${t("serverOverview.uploadShort")} ${formatBytes(up)} · ${t("serverOverview.downloadShort")} ${formatBytes(down)}`} tone={METRIC_TONE.traffic} icon={<Database className="size-3.5" strokeWidth={1.75} />} />
              <QuickMetric label={t("serverOverview.averageCpu")} value={onlineServers.length ? cpuPercent.toFixed(1) : "--"} unit={onlineServers.length ? "%" : undefined} detail={totalCores > 0 ? t("serverOverview.totalCores", { count: totalCores }) : "--"} tone={METRIC_TONE.cpu} icon={<Cpu className="size-3.5" strokeWidth={1.75} />} />
              <QuickMetric label={t("serverOverview.memoryUsage")} value={onlineServers.length ? formatBytes(usedMemory) : "--"} detail={totalMemory > 0 ? t("serverOverview.totalMemory", { size: formatBytes(totalMemory), percent: memoryPercent.toFixed(1) }) : "--"} tone={METRIC_TONE.memory} icon={<MemoryStick className="size-3.5" strokeWidth={1.75} />} />
              <QuickMetric label={t("serverOverview.diskUsage")} value={onlineServers.length ? formatBytes(usedDisk) : "--"} detail={totalDisk > 0 ? t("serverOverview.totalDisk", { size: formatBytes(totalDisk), percent: diskPercent.toFixed(1) }) : "--"} tone={METRIC_TONE.disk} icon={<HardDrive className="size-3.5" strokeWidth={1.75} />} />
            </div>
          </div>
          <div className="flex flex-col justify-end px-2 pb-3 pt-2 max-[967px]:order-1 max-[967px]:px-1.5 max-[967px]:pb-0 max-[967px]:pt-5 min-[1151px]:absolute min-[1151px]:inset-x-0 min-[1151px]:top-0 min-[1151px]:h-auto min-[1151px]:justify-start min-[1151px]:px-0 min-[1151px]:pb-0 min-[1151px]:pt-0">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <span className="inline-flex h-7 items-center justify-center rounded-full border border-[#078DEE]/20 bg-[color-mix(in_srgb,#078DEE_12%,var(--lite-paper))] px-2.5 text-[11px] font-medium leading-none text-[#078DEE] dark:border-[#078DEE]/30 min-[1151px]:translate-y-0 max-[967px]:absolute max-[967px]:left-[14px] max-[967px]:top-0 max-[967px]:z-10 max-[967px]:h-6 max-[967px]:-translate-y-1/2 max-[967px]:px-2.5">
                  {t("home.title")}
                </span>
                <h1 className="mt-4 text-[28px] font-semibold leading-none tracking-tight text-[#1C252E] dark:text-white max-[967px]:mt-1.5 max-[967px]:text-[22px] min-[1151px]:ml-[3px]">{t(greetingKey(now))}</h1>
                <p className="mt-3 text-[12px] text-[#919EAB] max-[967px]:mt-2 min-[1151px]:ml-[3px]">{t("home.subtitle")}</p>
              </div>
            </div>
          </div>
        </div>

        <aside className="flex min-w-0 flex-col gap-[11px] rounded-[14px] border border-[var(--lite-line)] bg-[var(--lite-paper)] p-4 shadow-[0_1px_2px_rgba(28,37,46,0.03)]">
          <div className="flex items-start justify-between gap-2">
            <div>
              <strong className="block text-[14px] font-semibold text-[#1C252E] dark:text-white">{t("serverOverview.runningStatus")}</strong>
              <small className="mt-1 block text-[11px] text-[#919EAB]">{t("serverOverview.statusHint")}</small>
            </div>
            <span className={cn("rounded-full px-2.5 py-1 text-[11px]", offline === 0 && total > 0 ? "bg-[#E3F7EB] text-[#148C54] dark:bg-[#1A4333] dark:text-[#7CDAA6]" : "bg-[#FFF4E5] text-[#B76E00] dark:bg-[#49351A] dark:text-[#F1C27D]")}>{offline === 0 && total > 0 ? t("serverOverview.healthy") : t("serverOverview.attention")}</span>
          </div>
          <div className="rounded-lg bg-[var(--lite-soft)] p-3.5">
            <div className="flex items-baseline gap-2">
              <button type="button" onClick={() => setStatus("online")} className="text-left text-[26px] font-semibold leading-none tabular-nums text-[#1C252E] dark:text-white">{availability}<small className="ml-0.5 text-[15px] font-medium text-[#637381]">%</small></button>
              <span className="text-[11px] text-[#637381]">{t("serverOverview.onlineRate")}</span>
              <button type="button" onClick={offline > 0 ? filterOffline : undefined} className={cn("ml-auto text-[11px] font-normal", status === "offline" ? "text-[#078DEE]" : "text-[#637381]", offline > 0 && "hover:text-[#078DEE]")}>{t("serverOverview.offlineCount", { count: offline })}</button>
            </div>
            <div className="mt-3 flex h-1.5 gap-1">{healthStatusDots(servers).map((isOnline, index) => <i key={index} className={cn("min-w-[4px] flex-1 rounded-full", isOnline ? "bg-[#22C55E]" : "bg-[#FF5630]")} />)}</div>
            <div className="mt-2.5 flex justify-between text-[11px] text-[#919EAB]"><span>{t("serverOverview.onlineCount", { count: online })}</span><span>{t("serverOverview.totalCount", { count: total })}</span></div>
          </div>
          <div className="min-h-0 flex-1 rounded-lg bg-[var(--lite-soft)] p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <strong className="text-[12px] font-semibold text-[#1C252E] dark:text-white">{t("serverOverview.liveTraffic")}</strong>
              <span className="text-[11px] text-[#919EAB]">{windowLabel || t("serverOverview.recentMinute")}</span>
            </div>
            <div className="grid grid-cols-2 gap-2"><TrafficMini samples={trafficSamples} tone="up" /><TrafficMini samples={trafficSamples} tone="down" /></div>
          </div>
        </aside>
      </div>
    </section>
  )
}
