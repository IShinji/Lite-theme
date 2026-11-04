import ServerFlag from "@/components/ServerFlag"
import ServerLatencySummary from "@/components/ServerLatencySummary"
import TrafficBar from "@/components/TrafficBar"
import { formatBytes, formatSpeed, splitFormattedMeasure } from "@/lib/format"
import type { HomeLatencyTaskSummary } from "@/lib/home-latency"
import type { PublicReturnRoute } from "@/lib/home-return-route"
import { saveHomeScroll } from "@/lib/home-scroll"
import { prefetchServerMonitor } from "@/lib/prefetch-monitor"
import { loadUsagePercent, resourceUsageTone } from "@/lib/meter-tone"
import { RESOURCE_SWATCH } from "@/lib/theme-tokens"
import { parseCardTags } from "@/lib/server-tags"
import { GetOsName } from "@/lib/logo-class"
import { readHideEmptyProbeWindow, readShowServerBandwidth, serverBandwidthLabel, shouldShowHomeProbeWindow } from "@/lib/theme-config"
import { calcTrafficUsed, cn, formatLiteInfo, parsePublicNote } from "@/lib/utils"
import { LiteServer } from "@/types/lite-api"
import { useQueryClient } from "@tanstack/react-query"
import { useCallback } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"

import PlanInfo from "./PlanInfo"
import BillingInfo from "./billingInfo"

function resourceFill(percent: number, swatch: string) {
  const tone = resourceUsageTone(percent)
  if (tone === "amber") return "var(--card-amber)"
  if (tone === "coral") return "var(--card-danger)"
  if (tone === "empty") return "transparent"
  return swatch
}

function ResourceMetric({ label, value, unit, percent, swatch }: { label: string; value: string; unit?: string; percent: number; swatch: string }) {
  const width = Math.min(100, Math.max(0, percent))
  return (
    <div>
      <div className="lite-server-card__metric-label">
        <span className="truncate">{label}</span>
        <b className="shrink-0 tabular-nums">
          {value}
          {unit ? <small>{unit}</small> : null}
        </b>
      </div>
      <div className="lite-server-card__meter" aria-hidden="true">
        <span style={{ width: `${width}%`, background: resourceFill(percent, swatch) }} />
      </div>
    </div>
  )
}

function SpeedValue({ text }: { text: string }) {
  const speed = splitFormattedMeasure(text)
  return (
    <strong className="lite-server-card__speed tabular-nums">
      {speed.value}
      <small>{speed.unit}</small>
    </strong>
  )
}

export default function ServerCard({
  now,
  serverInfo,
  latencySummaries,
  returnRoute,
}: {
  now: number
  serverInfo: LiteServer
  latencySummaries?: HomeLatencyTaskSummary[]
  returnRoute?: PublicReturnRoute
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
  const trafficUsed = calcTrafficUsed(info.net_out_transfer, info.net_in_transfer, info.traffic_limit_type)
  const bandwidth = serverBandwidthLabel(serverInfo.bandwidth)
  const showBandwidth = readShowServerBandwidth() && Boolean(bandwidth)
  const showTags = parseCardTags({ tags: serverInfo.tags, extra: parsedData?.planDataMod?.extra }).length > 0
  const showTraffic = info.traffic_limit > 0
  const showFooter = Boolean(parsedData?.billingDataMod || showTags || showBandwidth)
  const showProbeWindow = shouldShowHomeProbeWindow(latencySummaries?.length ?? 0, readHideEmptyProbeWindow())
  const openDetail = () => {
    saveHomeScroll()
    navigate(`/server/${serverInfo.id}`)
  }

  return (
    <article
      role="link"
      tabIndex={0}
      data-online={info.online ? "true" : "false"}
      data-probe-window={showProbeWindow ? "true" : "false"}
      onClick={openDetail}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.key !== "Enter" && event.key !== " ") return
        event.preventDefault()
        openDetail()
      }}
      className={cn("lite-server-card flex min-w-0 cursor-pointer flex-col", showProbeWindow ? "h-full" : "self-start")}
    >
      <div className="lite-server-card__frame">
        <header className="lite-server-card__hero">
          <div className="flex min-w-0 items-center gap-2.5">
            <ServerFlag country_code={info.country_code} className="h-[18px] w-[26px] rounded-[3px]" />
            <span className="min-w-0 flex-1">
              <strong className="lite-server-card__name block truncate" title={info.name}>{info.name}</strong>
              <span className="lite-server-card__subtitle block truncate">
                {systemName} · {info.arch || "--"}
              </span>
            </span>
            <span className={cn("lite-server-card__status inline-flex shrink-0 items-center gap-1.5 self-start", info.online ? "lite-server-card__status--online" : "lite-server-card__status--offline")}>
              <i className={cn("size-[5px] rounded-full", info.online ? "bg-[var(--card-green)]" : "bg-[var(--card-danger)]")} />
              {info.online ? t("online") : t("offline")}
            </span>
          </div>
          <div className="lite-server-card__rates">
            <div className="min-w-0">
              <span className="lite-server-card__rate-label lite-server-card__rate-label--up"><span>↑</span>{t("serverCard.upload")}</span>
              <SpeedValue text={formatSpeed(info.up)} />
              <span className="lite-server-card__rate-total block truncate tabular-nums">{t("serverCard.cumulative")} {formatBytes(info.net_out_transfer)}</span>
            </div>
            <div className="min-w-0">
              <span className="lite-server-card__rate-label lite-server-card__rate-label--down"><span>↓</span>{t("serverCard.download")}</span>
              <SpeedValue text={formatSpeed(info.down)} />
              <span className="lite-server-card__rate-total block truncate tabular-nums">{t("serverCard.cumulative")} {formatBytes(info.net_in_transfer)}</span>
            </div>
          </div>
        </header>

        <div className="lite-server-card__body">
          <section className="lite-server-card__resources">
            <ResourceMetric label="CPU" value={info.cpu.toFixed(1)} unit="%" percent={info.cpu} swatch={RESOURCE_SWATCH.cpu} />
            <ResourceMetric label={t("serverCard.mem")} value={info.mem.toFixed(1)} unit="%" percent={info.mem} swatch={RESOURCE_SWATCH.memory} />
            <ResourceMetric label={t("serverCard.stg")} value={info.stg.toFixed(1)} unit="%" percent={info.stg} swatch={RESOURCE_SWATCH.storage} />
            <ResourceMetric label={t("serverCard.load")} value={String(info.load_1)} percent={loadUsagePercent(info.load_1, info.cpu_cores)} swatch={RESOURCE_SWATCH.load} />
          </section>

          {showProbeWindow ? (
            <ServerLatencySummary
              summaries={latencySummaries}
              returnRoute={returnRoute}
              onPrefetch={prefetchMonitor}
              onSelectTask={(taskId) => {
                saveHomeScroll()
                prefetchMonitor(true)
                navigate(`/server/${serverInfo.uuid || serverInfo.id}?view=network&ping_task=${encodeURIComponent(taskId)}`)
              }}
            />
          ) : null}
        </div>

        {showTraffic || showFooter ? (
          <div className="lite-server-card__bottom">
            {showTraffic ? (
              <TrafficBar used={trafficUsed} limit={info.traffic_limit} resetDay={info.traffic_reset_day} limitType={info.traffic_limit_type} />
            ) : null}
            {showFooter ? (
              <footer className="lite-server-card__footer">
                {parsedData?.billingDataMod ? (
                  <BillingInfo
                    variant="card"
                    parsedData={parsedData}
                    remainingValue={serverInfo.remaining_value}
                    remainingValueCurrency={serverInfo.remaining_value_currency}
                  />
                ) : null}
                {(showTags || showBandwidth) ? (
                  <div className="ml-auto flex max-w-full min-w-0 flex-wrap items-center justify-end gap-x-[11px] gap-y-1.5">
                    {showTags ? <PlanInfo parsedData={parsedData} tags={serverInfo.tags} /> : null}
                    {showBandwidth ? (
                      <span className="lite-server-card__bandwidth">
                        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
                          <path d="M2 12h12M4 8.5h8M6.5 5h3" />
                        </svg>
                        {bandwidth}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </footer>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  )
}
