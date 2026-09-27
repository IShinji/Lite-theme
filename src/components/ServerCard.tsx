import ServerFlag from "@/components/ServerFlag"
import ServerLatencySummary from "@/components/ServerLatencySummary"
import TrafficBar from "@/components/TrafficBar"
import { formatBytes, formatSpeed } from "@/lib/format"
import type { HomeLatencyTaskSummary } from "@/lib/home-latency"
import { saveHomeScroll } from "@/lib/home-scroll"
import { prefetchServerMonitor } from "@/lib/prefetch-monitor"
import { METER_TONE_COLOR, loadUsagePercent, resourceUsageTone } from "@/lib/meter-tone"
import { RESOURCE_SWATCH } from "@/lib/theme-tokens"
import { GetOsName } from "@/lib/logo-class"
import { readShowServerBandwidth, serverBandwidthLabel } from "@/lib/theme-config"
import { calcTrafficUsed, cn, formatLiteInfo, parsePublicNote } from "@/lib/utils"
import { LiteServer } from "@/types/lite-api"
import { useQueryClient } from "@tanstack/react-query"
import { useCallback } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"

import PlanInfo from "./PlanInfo"
import BillingInfo from "./billingInfo"

function ResourceMetric({ label, value, percent, swatch }: { label: string; value: string; percent: number; swatch: string }) {
  const tone = METER_TONE_COLOR[resourceUsageTone(percent)]
  return (
    <div className="flex min-w-0 min-h-[42px] flex-col justify-center gap-1.5 py-2">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="inline-flex min-w-0 items-center gap-2">
          <i className="size-1.5 shrink-0 rounded-full" style={{ background: swatch }} aria-hidden="true" />
          <span className="min-w-0 truncate whitespace-nowrap text-[9px] text-[#919EAB]">{label}</span>
        </span>
        <strong className="shrink-0 text-[11px] font-semibold tabular-nums text-[#1C252E] dark:text-white max-[360px]:text-[10px]">{value}</strong>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-[#E9EEF2] dark:bg-[#2A3743]" aria-hidden="true">
        <span className="block h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, percent))}%`, background: tone }} />
      </div>
    </div>
  )
}

export default function ServerCard({
  now,
  serverInfo,
  latencySummaries,
  stackLatencyProbes,
}: {
  now: number
  serverInfo: LiteServer
  latencySummaries?: HomeLatencyTaskSummary[]
  stackLatencyProbes?: boolean
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const prefetchMonitor = useCallback(
    (priority: boolean) => prefetchServerMonitor(queryClient, serverInfo.id, { priority }),
    [queryClient, serverInfo.id],
  )
  const info = formatLiteInfo(now, serverInfo)
  const parsedData = parsePublicNote(info.public_note)
  const systemName = info.platform.includes("Windows") ? "Windows" : GetOsName(info.platform)
  const uptime = info.uptime / 86400 >= 1
    ? `${Math.floor(info.uptime / 86400)} ${t("serverCard.days")}`
    : `${Math.floor(info.uptime / 3600)} ${t("serverCard.hours")}`
  const trafficUsed = calcTrafficUsed(info.net_out_transfer, info.net_in_transfer, info.traffic_limit_type)
  const bandwidth = serverBandwidthLabel(serverInfo.bandwidth)
  const showBandwidth = readShowServerBandwidth() && Boolean(bandwidth)
  const showTags = Boolean(parsedData?.planDataMod || serverInfo.tags)
  const showFooter = Boolean(parsedData?.billingDataMod || showTags || showBandwidth)
  const openDetail = () => {
    saveHomeScroll()
    navigate(`/server/${serverInfo.id}`)
  }

  return (
    <article
      role="link"
      tabIndex={0}
      onClick={openDetail}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") openDetail()
      }}
      className="lite-server-card flex min-w-0 cursor-pointer flex-col rounded-[14px] border border-[var(--lite-line)] bg-[var(--lite-paper)] pb-0 shadow-[0_1px_2px_rgba(28,37,46,0.03)]"
    >
      <div className="flex min-w-0 flex-col overflow-hidden rounded-[inherit]">
      <header className="flex items-center gap-3 border-b border-[var(--lite-line)] px-[18px] py-3.5 max-[967px]:px-[15px] max-[967px]:py-3">
        <ServerFlag country_code={info.country_code} />
        <span className="min-w-0 flex-1">
          <strong className="block truncate text-sm font-semibold leading-[1.4] tracking-tight text-[#1C252E] dark:text-white" title={info.name}>{info.name}</strong>
          <span className="mt-1 block truncate text-[9px] text-[#919EAB]">
            {systemName} · {info.arch || "--"} · {info.online ? `${t("serverCard.uptime")} ${uptime}` : t("offline")}
          </span>
        </span>
        <span className={cn("inline-flex shrink-0 items-center gap-1.5 self-start text-[10px] font-medium", info.online ? "text-[#118D57] dark:text-[#61C8A5]" : "text-[#B71D18] dark:text-[#F18C84]")}>
          <i className={cn("size-[5px] rounded-full", info.online ? "bg-[#22C55E]" : "bg-[#FF5630]")} />
          {info.online ? t("online") : t("offline")}
        </span>
      </header>

      <section className="grid grid-cols-2 gap-x-4 gap-y-1 px-[18px] py-2 max-[967px]:gap-x-3 max-[967px]:px-[15px]">
        <ResourceMetric label="CPU" value={`${info.cpu.toFixed(1)}%`} percent={info.cpu} swatch={RESOURCE_SWATCH.cpu} />
        <ResourceMetric label={t("serverCard.mem")} value={`${info.mem.toFixed(1)}%`} percent={info.mem} swatch={RESOURCE_SWATCH.memory} />
        <ResourceMetric label={t("serverCard.stg")} value={`${info.stg.toFixed(1)}%`} percent={info.stg} swatch={RESOURCE_SWATCH.storage} />
        <ResourceMetric label={t("serverCard.load")} value={String(info.load_1)} percent={loadUsagePercent(info.load_1, info.cpu_cores)} swatch={RESOURCE_SWATCH.load} />
      </section>

      <section className="mx-[18px] mt-2.5 grid grid-cols-2 gap-5 border-t border-[var(--lite-line)] pb-3 pt-3 max-[967px]:mx-[15px] max-[967px]:gap-[18px] max-[967px]:pt-2.5">
        <div className="min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1 text-[10px] text-[#118D57] dark:text-[#61C8A5]"><span className="text-lg leading-none">↑</span>{t("serverCard.upload")}</span>
            <span className="truncate text-[9px] tabular-nums text-[#919EAB]">{t("serverCard.cumulative")} {formatBytes(info.net_out_transfer)}</span>
          </div>
          <strong className="mt-1.5 block truncate text-2xl font-semibold leading-tight tracking-tight tabular-nums text-[#1C252E] dark:text-white max-[967px]:text-[23px]">{formatSpeed(info.up)}</strong>
        </div>
        <div className="min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1 text-[10px] text-[#078DEE]"><span className="text-lg leading-none">↓</span>{t("serverCard.download")}</span>
            <span className="truncate text-[9px] tabular-nums text-[#919EAB]">{t("serverCard.cumulative")} {formatBytes(info.net_in_transfer)}</span>
          </div>
          <strong className="mt-1.5 block truncate text-2xl font-semibold leading-tight tracking-tight tabular-nums text-[#1C252E] dark:text-white max-[967px]:text-[23px]">{formatSpeed(info.down)}</strong>
        </div>
      </section>

      <ServerLatencySummary
        summaries={latencySummaries}
        stackProbes={stackLatencyProbes}
        onPrefetch={prefetchMonitor}
        onSelectTask={(taskId) => {
          saveHomeScroll()
          prefetchMonitor(true)
          navigate(`/server/${serverInfo.uuid || serverInfo.id}?view=network&ping_task=${encodeURIComponent(taskId)}`)
        }}
      />

      {info.traffic_limit > 0 && (
        <TrafficBar used={trafficUsed} limit={info.traffic_limit} resetDay={info.traffic_reset_day} limitType={info.traffic_limit_type} />
      )}

      {showFooter ? (
        <footer className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-t border-[var(--lite-line)] bg-[#F9FAFB] px-[18px] py-2.5 dark:bg-[#172230] max-[967px]:px-[15px] max-[967px]:py-2">
          {parsedData?.billingDataMod ? <BillingInfo parsedData={parsedData} /> : null}
          {(showTags || showBandwidth) && (
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5 max-[967px]:gap-1">
              {showTags ? <PlanInfo parsedData={parsedData} tags={serverInfo.tags} /> : null}
              {showBandwidth ? (
                <span className="whitespace-nowrap rounded-[6px] px-1.5 py-1 text-[9px] font-medium text-[#637381] bg-[#F4F6F8] dark:bg-[#2A3A4D] dark:text-[#C4CDD5]">
                  {bandwidth}
                </span>
              ) : null}
            </div>
          )}
        </footer>
      ) : null}
      </div>
    </article>
  )
}
