import HistoryTimePills from "@/components/HistoryTimePills"
import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { useWebSocketContext } from "@/hooks/use-websocket-context"
import TrafficSpeedTooltip, { TrafficHoverDots } from "@/components/TrafficSpeedTooltip"
import { formatBytes, formatClockTime, formatSpeed, splitFormattedMeasure } from "@/lib/format"
import { historyRefetchMs } from "@/lib/history-range"
import { fetchResourceHistory, type ResourceHistoryPoint } from "@/lib/lite-api"
import { clampPercent } from "@/lib/resource-history"
import { liveTrafficView, recordHomeTraffic, type TrafficSample } from "@/lib/live-traffic"
import { dualSeriesDomain, seriesPath } from "@/lib/sparkline"
import { trafficHoverIndex } from "@/lib/traffic-hover"
import { METER_TONE_COLOR, resourceUsageTone } from "@/lib/meter-tone"
import { RESOURCE_COLORS, RESOURCE_SWATCH } from "@/lib/theme-tokens"
import { calcTrafficUsed, cn, formatLiteInfo, parseLiteWebsocketMessage } from "@/lib/utils"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { Clock } from "lucide-react"
import { useMemo, useState, type MouseEvent } from "react"
import { useTranslation } from "react-i18next"
import { Area, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts"

import { ServerDetailChartLoading } from "./loading/ServerDetailLoading"

type ResourceKey = "cpu" | "memory" | "storage"
type HistoryCardKey = ResourceKey | "connections"
type HistoryUnit = "percent" | "count"

type HistorySeries = {
  key: string
  label: string
  color: string
}

function uniqueTooltipPayload<T extends { dataKey?: unknown }>(payload: T[] | undefined): T[] {
  if (!payload?.length) return []
  const seen = new Set<string>()
  return payload.filter((item) => {
    const key = String(item.dataKey ?? "")
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function formatChartTick(value: number, hours: number): string {
  const date = new Date(value)
  const minutes = date.getMinutes().toString().padStart(2, "0")
  const time = `${date.getHours()}:${minutes}`
  if (hours <= 24) return time
  return `${date.getMonth() + 1}/${date.getDate()} ${time}`
}

function SpeedMeasure({ text }: { text: string }) {
  const parts = splitFormattedMeasure(text)
  return (
    <strong className="lite-speed-measure">
      {parts.value}
      {parts.unit ? <small>{parts.unit}</small> : null}
    </strong>
  )
}

function cpuModelName(cpu: string[] | undefined): string {
  return [...new Set((cpu || []).map((name) => name.trim()).filter(Boolean))][0] || ""
}

function ResourceMetric({
  label,
  value,
  used,
  total,
  extra,
  swatch,
  percent,
  dataKey,
}: {
  label: string
  value: string
  used?: string
  total?: string
  extra?: string
  swatch: string
  percent: number
  dataKey?: ResourceKey
}) {
  const tone = resourceUsageTone(percent)
  const fill = tone === "amber" ? "var(--card-amber, #F0A632)" : tone === "coral" ? "var(--card-danger, #FF5630)" : swatch
  const usage = [used, total].filter(Boolean).join(" / ")
  return (
    <div data-testid={dataKey ? `resource-realtime-${dataKey}` : undefined} className="lite-resource-metric">
      <div className="lite-resource-metric__top">
        <span><i style={{ background: swatch }} />{label}</span>
        <b>{value}</b>
      </div>
      <div className="lite-resource-metric__meter" aria-hidden="true"><i style={{ width: `${Math.min(100, Math.max(0, percent))}%`, background: fill }} /></div>
      {usage || extra ? (
        <p className="lite-resource-metric__detail">
          {usage ? <span>{usage}</span> : <span />}
          {extra ? <span className="lite-resource-metric__extra" title={extra}>{extra}</span> : null}
        </p>
      ) : null}
    </div>
  )
}

function TrafficChart({ samples }: { samples: TrafficSample[] }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const upValues = samples.map((sample) => sample.up)
  const downValues = samples.map((sample) => sample.down)
  const domain = dualSeriesDomain(upValues, downValues)
  const up = seriesPath(upValues, 760, 220, 8, 10, domain)
  const down = seriesPath(downValues, 760, 220, 8, 10, domain)
  const first = samples[0]?.t
  const last = samples.at(-1)?.t
  const labels = [first, first && last ? first + (last - first) * 0.25 : undefined, first && last ? first + (last - first) * 0.5 : undefined, first && last ? first + (last - first) * 0.75 : undefined, last]
  const hover = hoverIndex !== null ? samples[hoverIndex] : null
  const hoverUp = hoverIndex !== null ? up.points[hoverIndex] : null
  const hoverDown = hoverIndex !== null ? down.points[hoverIndex] : null
  const onMove = (event: MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    setHoverIndex(trafficHoverIndex(event.clientX, rect.left, rect.width, samples.length))
  }
  return (
    <div className="lite-traffic-chart">
      <div className="lite-traffic-chart__plot" onMouseMove={onMove} onMouseLeave={() => setHoverIndex(null)}>
        <svg viewBox="0 0 760 220" preserveAspectRatio="none">
          <path d="M0 35H760 M0 88H760 M0 141H760 M0 194H760" fill="none" stroke="currentColor" strokeOpacity=".12" strokeDasharray="4 6" />
          {up.area ? <path d={up.area} fill="#078DEE" fillOpacity=".10" /> : null}
          {down.area ? <path d={down.area} fill="#21B96B" fillOpacity=".08" /> : null}
          {up.line ? <path d={up.line} fill="none" stroke="#078DEE" strokeWidth="1.75" /> : null}
          {down.line ? <path d={down.line} fill="none" stroke="#21B96B" strokeWidth="1.75" /> : null}
          {hover && hoverUp ? (
            <line x1={hoverUp.x} x2={hoverUp.x} y1="8" y2="210" className="lite-traffic-tip__rule" />
          ) : null}
        </svg>
        {hover && hoverUp && hoverDown ? (
          <>
            <TrafficHoverDots up={hoverUp} down={hoverDown} width={760} height={220} />
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
      <div className="pointer-events-none absolute inset-x-3 bottom-1.5 flex justify-between text-[10px] text-[#919EAB]">{labels.map((label, index) => <span key={index}>{label ? formatClockTime(label) : "--:--"}</span>)}</div>
    </div>
  )
}

function formatHistoryValue(value: number, unit: HistoryUnit): string {
  if (unit === "count") return Math.round(value).toLocaleString()
  return `${value.toFixed(1)}%`
}

function ResourceHistoryCard({
  label,
  dataKey,
  hours,
  chartData,
  isLoading,
  series,
  unit = "percent",
}: {
  label: string
  dataKey: HistoryCardKey
  hours: number
  chartData: Array<Record<string, number | null>>
  isLoading: boolean
  series: HistorySeries[]
  unit?: HistoryUnit
}) {
  const { t } = useTranslation()
  const titleColor = series[0]?.color || RESOURCE_COLORS.cpu
  const hasChartData = series.some((item) => chartData.some((point) => Number.isFinite(point[item.key])))
  const chartConfig = Object.fromEntries(series.map((item) => [item.key, { label: item.label, color: item.color }])) as ChartConfig
  const legendSeries = series.filter((item) => item.label !== label)
  const showLegend = legendSeries.length > 0

  return (
    <section data-testid={`resource-history-${dataKey}`} className="lite-trend-card min-w-0">
      <header className="lite-trend-card__head">
        <h3 className="m-0 flex min-w-0 items-center gap-2 text-[13px] font-semibold text-[#1C252E] dark:text-white">
          <span className="size-2 shrink-0 rounded-[2px]" style={{ backgroundColor: titleColor }} />
          <span className="truncate">{label}</span>
        </h3>
        {showLegend ? (
          <div className="ml-auto flex min-w-0 items-center gap-2.5 text-[11px] text-[#919EAB]">
            {legendSeries.map((item) => (
              <span key={item.key} className="inline-flex items-center gap-1">
                <i className="size-1.5 rounded-full" style={{ backgroundColor: item.color }} />
                {item.label}
              </span>
            ))}
          </div>
        ) : null}
      </header>
      <div className="lite-trend-card__plot relative">
        <div className="h-[220px] max-[620px]:h-[180px]">
          <ChartContainer config={chartConfig} className="h-full w-full">
            <ComposedChart data={chartData} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="rgba(145,158,171,0.20)" />
              <XAxis
                dataKey="timeStamp"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={36}
                tickFormatter={(tick) => formatChartTick(Number(tick), hours)}
              />
              <YAxis
                width={unit === "count" ? 40 : 42}
                tickLine={false}
                axisLine={false}
                domain={unit === "percent" ? [0, 100] : [0, "auto"]}
                allowDecimals={unit !== "count"}
                tickFormatter={(tick) => (unit === "percent" ? `${tick}%` : String(Math.round(Number(tick))))}
              />
              <ChartTooltip
                isAnimationActive={false}
                defaultIndex={undefined}
                trigger="hover"
                content={({ active, payload }) => (
                  <ChartTooltipContent
                    active={active}
                    payload={uniqueTooltipPayload(payload)}
                    indicator="line"
                    labelFormatter={(_, items) => formatChartTick(Number(items[0]?.payload?.timeStamp || 0), hours)}
                    formatter={(tooltipValue, name) => {
                      const seriesLabel = series.find((item) => item.key === name || item.label === name)?.label || name
                      return (
                        <div className="flex min-w-[110px] items-center justify-between gap-4">
                          <span className="text-[#919EAB]">{seriesLabel}</span>
                          <strong className="font-medium tabular-nums">{formatHistoryValue(Number(tooltipValue), unit)}</strong>
                        </div>
                      )
                    }}
                  />
                )}
              />
              {series.map((item) => (
                <Area key={`${item.key}-area`} type="monotone" dataKey={item.key} name={item.key} stroke="none" fill={item.color} fillOpacity={0.12} isAnimationActive={false} tooltipType="none" />
              ))}
              {series.map((item) => (
                <Line key={`${item.key}-line`} type="monotone" dataKey={item.key} name={item.key} stroke={item.color} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
              ))}
            </ComposedChart>
          </ChartContainer>
        </div>
        {!hasChartData && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-[#919EAB]">
            {isLoading ? t("common.loading") : t("serverDetail.noHistory")}
          </div>
        )}
      </div>
    </section>
  )
}

export default function ServerDetailChart({ server_id, show = true }: { server_id: number; show?: boolean }) {
  const { t } = useTranslation()
  const { lastMessage, connected } = useWebSocketContext()
  const [hours, setHours] = useState(1)

  const websocketData = parseLiteWebsocketMessage(lastMessage?.data)
  const server = websocketData?.servers.find((item) => item.id === server_id)
  const totals = {
    memTotal: server?.host.mem_total || 0,
    diskTotal: server?.host.disk_total || 0,
    swapTotal: server?.host.swap_total || 0,
  }

  const { data: history = [], isPending } = useQuery({
    queryKey: ["resource-history", server_id, hours, totals.memTotal, totals.diskTotal, totals.swapTotal],
    queryFn: () => fetchResourceHistory(server_id, hours, totals),
    enabled: show && !!server,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    refetchInterval: show ? historyRefetchMs(hours) : false,
    staleTime: 20_000,
  })

  const chartData = useMemo(() => {
    const points: ResourceHistoryPoint[] = [...history]
    if (server && websocketData) {
      const info = formatLiteInfo(websocketData.now, server)
      const latest = points.at(-1)
      if (!latest || latest.timeStamp !== websocketData.now) {
        points.push({
          timeStamp: websocketData.now,
          cpu: info.cpu,
          memory: info.mem,
          swap: totals.swapTotal > 0 ? info.swap : null,
          storage: info.disk,
          tcp: info.tcp,
          udp: info.udp,
        })
      }
    }
    return points
  }, [history, server, websocketData])
  const trafficSamples = useMemo(() => {
    if (!server || !websocketData) return []
    const view = liveTrafficView(formatLiteInfo(websocketData.now, server).online, server.state.net_out_speed / 1024 / 1024, server.state.net_in_speed / 1024 / 1024)
    return recordHomeTraffic(view.up, view.down, websocketData.now)
  }, [server, websocketData])

  if ((!connected && !lastMessage) || !websocketData || !server) return <ServerDetailChartLoading />

  const info = formatLiteInfo(websocketData.now, server)
  const liveView = liveTrafficView(info.online, info.up, info.down)
  const trafficUsed = calcTrafficUsed(info.net_out_transfer, info.net_in_transfer, info.traffic_limit_type)
  const trafficRemaining = info.traffic_limit > 0 ? Math.max(0, info.traffic_limit - trafficUsed) : null
  const trafficPercent = info.traffic_limit > 0 ? clampPercent((trafficUsed / info.traffic_limit) * 100) : 0
  const uptimeDays = Math.floor(info.uptime / 86400)
  const uptimeHours = Math.floor((info.uptime % 86400) / 3600)
  const trafficTone = info.traffic_limit > 0 ? METER_TONE_COLOR[resourceUsageTone(trafficPercent)] : undefined
  const usedCores = info.cpu_cores ? (info.cpu / 100) * info.cpu_cores : 0
  const memUsed = server.state.mem_used || 0
  const swapUsed = server.state.swap_used || 0
  const diskUsed = server.state.disk_used || 0
  const coreUnit = t("serverOverview.coreUnit")
  const memorySeries = [
    { key: "memory", label: t("serverDetail.mem"), color: RESOURCE_SWATCH.memory },
    ...(totals.swapTotal > 0 ? [{ key: "swap", label: t("serverDetail.swap"), color: RESOURCE_SWATCH.swap }] : []),
  ]
  const connectionSeries = [
    { key: "tcp", label: t("serverDetail.tcp"), color: RESOURCE_COLORS.tcp },
    { key: "udp", label: t("serverDetail.udp"), color: RESOURCE_COLORS.udp },
  ]

  return (
    <div className="lite-resource-page">
      <div className="lite-resource-layout">
        <section className="lite-panel lite-traffic-panel" aria-labelledby="traffic-title">
          <header className="lite-panel__heading">
            <div>
              <h2 id="traffic-title">{t("serverDetail.liveTraffic")}</h2>
            </div>
            <span className={cn("lite-live-dot", !liveView.live && "is-offline")}>{liveView.live ? t("serverDetail.liveUpdating") : t("serverDetail.liveOffline")}</span>
          </header>
          <div className="lite-speed-pair">
            <div>
              <span className="lite-speed-pair__label is-up">↑ {t("serverDetail.upload")}</span>
              <SpeedMeasure text={formatSpeed(liveView.up)} />
              <p>{t("serverDetail.cumulative")} {formatBytes(info.net_out_transfer)}</p>
            </div>
            <div>
              <span className="lite-speed-pair__label is-down">↓ {t("serverDetail.download")}</span>
              <SpeedMeasure text={formatSpeed(liveView.down)} />
              <p>{t("serverDetail.cumulative")} {formatBytes(info.net_in_transfer)}</p>
            </div>
          </div>
          <div className="lite-traffic-plot">
            <TrafficChart samples={trafficSamples} />
          </div>
          <div className="lite-quota" aria-label={t("serverDetail.trafficUsage")}>
            <div className="lite-quota__label">
              <h3>{t("serverDetail.periodTraffic")}</h3>
              <span>
                <b>{formatBytes(trafficUsed)}</b>
                <small>{info.traffic_limit > 0 ? `/ ${formatBytes(info.traffic_limit)}` : t("serverDetail.unlimited")}</small>
              </span>
              <strong style={trafficTone ? { color: trafficTone } : undefined}>{info.traffic_limit > 0 ? `${trafficPercent.toFixed(1)}%` : "--"}</strong>
            </div>
            <div data-testid="traffic-usage-progress" className="lite-quota__meter">
              <i style={{ width: info.traffic_limit > 0 ? `${trafficPercent}%` : 0, background: trafficTone || "#078DEE" }} />
            </div>
            <div className="lite-quota__detail">
              <span>{t("serverDetail.used")} {formatBytes(trafficUsed)}</span>
              <span>{trafficRemaining === null ? "--" : `${t("serverDetail.remaining")} ${formatBytes(trafficRemaining)}`}</span>
            </div>
          </div>
        </section>
        <section className="lite-panel lite-resources-panel" aria-labelledby="resource-usage-title" aria-label={t("serverDetail.resourceUsage")}>
          <header className="lite-panel__heading">
            <div>
              <h2 id="resource-usage-title">{t("serverDetail.currentResources")}</h2>
            </div>
            <span className="lite-panel__subtle">{t("serverDetail.realtime")}</span>
          </header>
          <div className="lite-resource-metrics">
            <ResourceMetric
              dataKey="cpu"
              label="CPU"
              percent={info.cpu}
              used={info.cpu_cores ? `${usedCores.toFixed(2)} ${coreUnit}` : undefined}
              total={info.cpu_cores ? `${info.cpu_cores} ${coreUnit}` : undefined}
              extra={cpuModelName(server.host.cpu)}
              value={`${info.cpu.toFixed(1)}%`}
              swatch={RESOURCE_SWATCH.cpu}
            />
            <ResourceMetric
              dataKey="memory"
              label={t("serverDetail.mem")}
              percent={info.mem}
              used={info.mem_total ? formatBytes(memUsed) : undefined}
              total={info.mem_total ? formatBytes(info.mem_total) : undefined}
              value={`${info.mem.toFixed(1)}%`}
              swatch={RESOURCE_SWATCH.memory}
            />
            <ResourceMetric
              label={t("serverDetail.swap")}
              percent={Number.isFinite(info.swap) ? info.swap : 0}
              used={formatBytes(swapUsed || 0)}
              total={formatBytes(info.swap_total || 0)}
              value={`${Number.isFinite(info.swap) ? info.swap.toFixed(1) : "0.0"}%`}
              swatch={RESOURCE_SWATCH.swap}
            />
            <ResourceMetric
              dataKey="storage"
              label={t("serverDetail.storage")}
              percent={info.disk}
              used={info.disk_total ? formatBytes(diskUsed) : undefined}
              total={info.disk_total ? formatBytes(info.disk_total) : undefined}
              value={`${info.disk.toFixed(1)}%`}
              swatch={RESOURCE_SWATCH.storage}
            />
          </div>
          <div className="lite-load-row">
            <span><i style={{ background: RESOURCE_SWATCH.load }} />{t("serverDetail.load")}</span>
            <div>
              <strong>{info.load_1}<small>{t("serverDetail.load1")}</small></strong>
              <strong>{info.load_5}<small>{t("serverDetail.load5")}</small></strong>
              <strong>{info.load_15}<small>{t("serverDetail.load15")}</small></strong>
            </div>
          </div>
          <div className="lite-resource-foot">
            <div className="lite-system-snapshot">
              <div>
                <span>{t("serverDetail.runtimeInfo")}</span>
                <b>
                  {info.uptime >= 86400 ? (
                    <>
                      {uptimeDays} {t("serverDetail.days")} {uptimeHours}
                      <small> {t("serverDetail.hours")}</small>
                    </>
                  ) : (
                    <>
                      {Math.floor(info.uptime / 3600)}
                      <small> {t("serverDetail.hours")}</small>
                    </>
                  )}
                </b>
              </div>
              <div>
                <span>{t("serverDetailChart.process")}</span>
                <b>{info.process}</b>
              </div>
              <div>
                <span>TCP</span>
                <b>{info.tcp}</b>
              </div>
              <div>
                <span>UDP</span>
                <b>{info.udp}</b>
              </div>
            </div>
            <div className="lite-last-report">
              <Clock className="size-3.5" strokeWidth={1.75} />
              {t("serverDetail.lastActive")}
              <span>{info.last_active_time_string || "--"}</span>
            </div>
          </div>
        </section>
      </div>

      <section className="lite-panel lite-history-section" aria-labelledby="resource-history-title">
        <header className="lite-history-heading">
          <h2 id="resource-history-title">{t("serverDetail.resourceTrend")}</h2>
          <div className="lite-history-controls">
            <HistoryTimePills hours={hours} onChange={setHours} />
          </div>
        </header>
        <div className="lite-trend-grid grid grid-cols-1 min-[720px]:grid-cols-2 min-[1101px]:grid-cols-4">
          <ResourceHistoryCard
            label="CPU"
            dataKey="cpu"
            hours={hours}
            chartData={chartData}
            isLoading={isPending}
            series={[{ key: "cpu", label: "CPU", color: RESOURCE_SWATCH.cpu }]}
          />
          <ResourceHistoryCard
            label={t("serverDetail.mem")}
            dataKey="memory"
            hours={hours}
            chartData={chartData}
            isLoading={isPending}
            series={memorySeries}
          />
          <ResourceHistoryCard
            label={t("serverDetail.storage")}
            dataKey="storage"
            hours={hours}
            chartData={chartData}
            isLoading={isPending}
            series={[{ key: "storage", label: t("serverDetail.storage"), color: RESOURCE_SWATCH.storage }]}
          />
          <ResourceHistoryCard
            label={t("serverDetail.connections")}
            dataKey="connections"
            hours={hours}
            chartData={chartData}
            isLoading={isPending}
            series={connectionSeries}
            unit="count"
          />
        </div>
      </section>
    </div>
  )
}
