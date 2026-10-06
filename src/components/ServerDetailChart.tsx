import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { useWebSocketContext } from "@/hooks/use-websocket-context"
import { formatBytes, formatSpeed } from "@/lib/format"
import { HISTORY_TIME_OPTIONS, historyRefetchMs } from "@/lib/history-range"
import { fetchResourceHistory, type ResourceHistoryPoint } from "@/lib/lite-api"
import { clampPercent } from "@/lib/resource-history"
import { recordHomeTraffic, type TrafficSample } from "@/lib/live-traffic"
import { seriesPath } from "@/lib/sparkline"
import { METER_TONE_COLOR, resourceUsageTone } from "@/lib/meter-tone"
import { RESOURCE_COLORS, RESOURCE_SWATCH } from "@/lib/theme-tokens"
import { calcTrafficUsed, cn, formatLiteInfo, parseLiteWebsocketMessage } from "@/lib/utils"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { MenuItem, Select } from "@mui/material"
import { useMemo, useState } from "react"
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

function InfoCell({ label, value, accent, wrap }: { label: string; value: string; accent?: string; wrap?: boolean }) {
  return (
    <div className="min-w-0 border-b border-[var(--lite-line)] py-[13px] sm:[&:nth-last-child(-n+2)]:border-b-0">
      <p className="text-[12px] text-[#919EAB]">{label}</p>
      <strong className={cn("mt-[7px] block text-base font-semibold tabular-nums text-[#1C252E] dark:text-white", wrap ? "whitespace-normal break-all leading-snug" : "truncate", accent)}>{value}</strong>
    </div>
  )
}

function ResourceMetric({
  label,
  value,
  used,
  total,
  swatch,
  dataKey,
  extra,
}: {
  label: string
  value: string
  used?: string
  total?: string
  swatch: string
  dataKey?: ResourceKey
  extra?: {
    label: string
    value: string
    used?: string
    total?: string
    swatch: string
  }
}) {
  return (
    <div
      data-testid={dataKey ? `resource-realtime-${dataKey}` : undefined}
      className="border-b border-[var(--lite-line)] py-3 last:border-b-0"
    >
      <MetricLine label={label} value={value} used={used} total={total} swatch={swatch} />
      {extra ? (
        <div className="mt-3 border-t border-[var(--lite-line)] pt-3">
          <MetricLine label={extra.label} value={extra.value} used={extra.used} total={extra.total} swatch={extra.swatch} />
        </div>
      ) : null}
    </div>
  )
}

function MetricLine({
  label,
  value,
  used,
  total,
  swatch,
}: {
  label: string
  value: string
  used?: string
  total?: string
  swatch: string
}) {
  return (
    <div className="grid min-w-0 grid-cols-[6px_minmax(0,1fr)_auto] items-center gap-x-2">
      <i className={cn("size-1.5 rounded-full", used && total ? "self-start translate-y-[7px]" : "")} style={{ background: swatch }} />
      <div className="min-w-0">
        <span className="block truncate text-[13px] font-medium text-[#1C252E] dark:text-white">{label}</span>
        {used && total ? (
          <p className="mt-1 truncate text-[11px] tabular-nums text-[#919EAB]">
            {used}
            <span className="mx-1 text-[#C4CDD5] dark:text-[#637381]">/</span>
            {total}
          </p>
        ) : null}
      </div>
      <strong className="text-[13px] font-semibold tabular-nums text-[#1C252E] dark:text-white">{value}</strong>
    </div>
  )
}

function TrafficChart({ samples }: { samples: TrafficSample[] }) {
  const up = seriesPath(samples.map((sample) => sample.up), 760, 220, 8, 0)
  const down = seriesPath(samples.map((sample) => sample.down), 760, 220, 8, 0)
  const formatTime = (value?: number) => value ? new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) : "--:--"
  const first = samples[0]?.t
  const last = samples.at(-1)?.t
  const labels = [first, first && last ? first + (last - first) * 0.25 : undefined, first && last ? first + (last - first) * 0.5 : undefined, first && last ? first + (last - first) * 0.75 : undefined, last]
  return (
    <div className="relative min-h-[240px] flex-1 overflow-hidden rounded-lg bg-[var(--lite-soft)] px-2 pt-2 max-[620px]:h-[150px] max-[620px]:min-h-[150px] max-[620px]:flex-none">
      <svg viewBox="0 0 760 220" preserveAspectRatio="none" className="absolute inset-0 block h-full w-full" aria-hidden="true">
        <path d="M0 35H760 M0 88H760 M0 141H760 M0 194H760" fill="none" stroke="currentColor" strokeOpacity=".12" strokeDasharray="4 6" />
        {up.area ? <path d={up.area} fill="#078DEE" fillOpacity=".10" /> : null}
        {down.area ? <path d={down.area} fill="#21B96B" fillOpacity=".08" /> : null}
        {up.line ? <path d={up.line} fill="none" stroke="#078DEE" strokeWidth="1.75" /> : null}
        {down.line ? <path d={down.line} fill="none" stroke="#21B96B" strokeWidth="1.75" /> : null}
      </svg>
      <div className="pointer-events-none absolute inset-x-2 bottom-1 flex justify-between text-[10px] text-[#919EAB]">{labels.map((label, index) => <span key={index}>{formatTime(label)}</span>)}</div>
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
    <section data-testid={`resource-history-${dataKey}`} className="min-w-0 overflow-hidden rounded-[14px] border border-[var(--lite-line)] bg-[var(--lite-paper)] shadow-[0_1px_2px_rgba(28,37,46,0.03)]">
      <header className="flex min-h-[44px] items-center gap-3 px-4">
        <h3 className="m-0 flex min-w-0 items-center gap-2 text-[13px] font-semibold text-[#1C252E] dark:text-white">
          <span className="size-2 shrink-0 rounded-[2px]" style={{ backgroundColor: titleColor }} />
          <span className="truncate">{label}</span>
        </h3>
        {showLegend ? (
          <div className="ml-auto flex min-w-0 shrink-0 items-center gap-2.5 text-[11px] text-[#919EAB]">
            {legendSeries.map((item) => (
              <span key={item.key} className="inline-flex items-center gap-1">
                <i className="size-1.5 rounded-full" style={{ backgroundColor: item.color }} />
                {item.label}
              </span>
            ))}
          </div>
        ) : null}
      </header>
      <div className="relative px-3 pb-3 pt-2">
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
  const trafficSamples = useMemo(() => server && websocketData ? recordHomeTraffic(server.state.net_out_speed / 1024 / 1024, server.state.net_in_speed / 1024 / 1024, websocketData.now) : [], [server, websocketData])

  if ((!connected && !lastMessage) || !websocketData || !server) return <ServerDetailChartLoading />

  const info = formatLiteInfo(websocketData.now, server)
  const trafficUsed = calcTrafficUsed(info.net_out_transfer, info.net_in_transfer, info.traffic_limit_type)
  const trafficRemaining = info.traffic_limit > 0 ? Math.max(0, info.traffic_limit - trafficUsed) : null
  const trafficPercent = info.traffic_limit > 0 ? clampPercent((trafficUsed / info.traffic_limit) * 100) : 0
  const uptime = info.uptime >= 86400
    ? `${Math.floor(info.uptime / 86400)} ${t("serverDetail.days")} ${Math.floor((info.uptime % 86400) / 3600)} ${t("serverDetail.hours")}`
    : `${Math.floor(info.uptime / 3600)} ${t("serverDetail.hours")}`
  const trafficTone = info.traffic_limit > 0 ? METER_TONE_COLOR[resourceUsageTone(trafficPercent)] : undefined
  const usedCores = info.cpu_cores ? (info.cpu / 100) * info.cpu_cores : 0
  const memUsed = server.state.mem_used || 0
  const swapUsed = server.state.swap_used || 0
  const diskUsed = server.state.disk_used || 0
  const coreUnit = t("serverOverview.coreUnit")
  const memorySeries = [
    { key: "memory", label: t("serverDetail.mem"), color: RESOURCE_COLORS.memory },
    ...(totals.swapTotal > 0 ? [{ key: "swap", label: t("serverDetail.swap"), color: RESOURCE_COLORS.swap }] : []),
  ]
  const connectionSeries = [
    { key: "tcp", label: t("serverDetail.tcp"), color: RESOURCE_COLORS.tcp },
    { key: "udp", label: t("serverDetail.udp"), color: RESOURCE_COLORS.udp },
  ]

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 min-[1101px]:grid-cols-[minmax(0,1.8fr)_minmax(300px,.92fr)] min-[1101px]:grid-rows-[minmax(0,1fr)_auto]">
        <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[14px] border border-[var(--lite-line)] bg-[var(--lite-paper)] shadow-[0_1px_2px_rgba(28,37,46,0.03)] min-[1101px]:col-start-1 min-[1101px]:row-start-1" aria-labelledby="traffic-title">
          <header className="flex shrink-0 items-start justify-between gap-3 px-5 py-4"><div><h2 id="traffic-title" className="m-0 text-[14px] font-semibold text-[#1C252E] dark:text-white">{t("serverDetail.liveTraffic")}</h2><p className="mt-1 text-[12px] text-[#919EAB]">{t("serverDetail.trafficSubtitle")}</p></div><Select size="small" value={String(hours)} onChange={(event) => setHours(Number(event.target.value))} aria-label={t("monitor.timeRange")} sx={{ width: 126, height: 32, fontSize: 12 }}><MenuItem value="1">{t("serverDetail.oneHour")}</MenuItem><MenuItem value="24">{t("serverDetail.oneDay")}</MenuItem><MenuItem value="168">{t("serverDetail.sevenDays")}</MenuItem></Select></header>
          <div className="grid shrink-0 grid-cols-2 gap-3 px-5 max-[620px]:gap-2"><div className="rounded-[12px] bg-[var(--lite-soft)] px-3.5 py-3"><span className="block text-[11px] text-[#078DEE]">↑ {t("serverDetail.upload")}</span><strong className="mt-2 block text-[22px] font-semibold tabular-nums text-[#1C252E] dark:text-white">{formatSpeed(info.up)} </strong><small className="mt-2.5 block text-[11px] text-[#919EAB]">{t("serverDetail.cumulative")} {formatBytes(info.net_out_transfer)}</small></div><div className="rounded-[12px] bg-[var(--lite-soft)] px-3.5 py-3"><span className="block text-[11px] text-[#118D57]">↓ {t("serverDetail.download")}</span><strong className="mt-2 block text-[22px] font-semibold tabular-nums text-[#1C252E] dark:text-white">{formatSpeed(info.down)}</strong><small className="mt-2.5 block text-[11px] text-[#919EAB]">{t("serverDetail.cumulative")} {formatBytes(info.net_in_transfer)}</small></div></div>
          <div className="flex min-h-[240px] min-w-0 flex-1 flex-col px-5 pb-5 pt-3 max-[620px]:min-h-[150px] max-[620px]:flex-none"><TrafficChart samples={trafficSamples} /><div className="mt-2.5 flex shrink-0 items-center gap-4 text-[12px] text-[#637381]"><span><i className="mr-1 inline-block size-1.5 rounded-full bg-[#078DEE]" />{t("serverDetail.upload")}</span><span><i className="mr-1 inline-block size-1.5 rounded-full bg-[#21B96B]" />{t("serverDetail.download")}</span><span className="ml-auto text-[#919EAB]">{t("serverDetail.recentUpdate")}</span></div></div>
        </section>
        <section className="overflow-hidden rounded-[14px] border border-[var(--lite-line)] bg-[var(--lite-paper)] shadow-[0_1px_2px_rgba(28,37,46,0.03)] min-[1101px]:col-start-1 min-[1101px]:row-start-2"><header className="flex items-start justify-between px-5 py-4"><div><h3 className="m-0 text-[14px] font-semibold">{t("serverDetail.trafficUsage")}</h3><p className="mt-1 text-[12px] text-[#919EAB]">{t("serverDetail.currentPeriod")}</p></div><strong className="text-[13px] font-semibold" style={trafficTone ? { color: trafficTone } : undefined}>{info.traffic_limit > 0 ? `${trafficPercent.toFixed(0)}%` : "--"}</strong></header><div className="px-5 pb-5"><div className="flex items-baseline gap-2"><strong className="text-[26px] font-semibold tabular-nums text-[#1C252E] dark:text-white">{formatBytes(trafficUsed)}</strong><span className="text-[12px] text-[#637381]">{info.traffic_limit > 0 ? `/ ${formatBytes(info.traffic_limit)}` : t("serverDetail.unlimited")}</span></div><div data-testid="traffic-usage-progress" className="mt-3 h-[5px] overflow-hidden rounded-[3px] bg-[#E8EDF1] dark:bg-[#2A3A4D]"><span className="block h-full rounded-[3px]" style={{ width: info.traffic_limit > 0 ? `${trafficPercent}%` : 0, background: trafficTone || "#078DEE" }} /></div><div className="mt-2.5 flex justify-between text-[11px] text-[#919EAB]"><span>{t("serverDetail.used")} {formatBytes(trafficUsed)}</span><span>{trafficRemaining === null ? "--" : `${t("serverDetail.remaining")} ${formatBytes(trafficRemaining)}`}</span></div></div></section>
        <div className="flex min-w-0 flex-col gap-3 min-[1101px]:col-start-2 min-[1101px]:row-span-2 min-[1101px]:row-start-1">
          <section className="min-w-0 overflow-hidden rounded-[14px] border border-[var(--lite-line)] bg-[var(--lite-paper)] shadow-[0_1px_2px_rgba(28,37,46,0.03)]" aria-labelledby="resource-usage-title"><header className="flex items-start justify-between px-5 py-4"><div><h2 id="resource-usage-title" className="m-0 text-[14px] font-semibold text-[#1C252E] dark:text-white">{t("serverDetail.resourceUsage")}</h2><p className="mt-1 text-[12px] text-[#919EAB]">{t("serverDetail.currentDevice")}</p></div></header><div className="px-5 pb-2"><ResourceMetric dataKey="cpu" label="CPU" used={info.cpu_cores ? t("serverDetail.usedAmount", { value: `${usedCores.toFixed(2)} ${coreUnit}` }) : undefined} total={info.cpu_cores ? t("serverDetail.totalAmount", { value: `${info.cpu_cores} ${coreUnit}` }) : undefined} value={`${info.cpu.toFixed(1)}%`} swatch={RESOURCE_SWATCH.cpu} /><ResourceMetric dataKey="memory" label={t("serverDetail.mem")} used={info.mem_total ? t("serverDetail.usedAmount", { value: formatBytes(memUsed) }) : undefined} total={info.mem_total ? t("serverDetail.totalAmount", { value: formatBytes(info.mem_total) }) : undefined} value={`${info.mem.toFixed(1)}%`} swatch={RESOURCE_SWATCH.memory} extra={{ label: t("serverDetail.swap"), used: t("serverDetail.usedAmount", { value: formatBytes(swapUsed || 0) }), total: t("serverDetail.totalAmount", { value: formatBytes(info.swap_total || 0) }), value: `${Number.isFinite(info.swap) ? info.swap.toFixed(1) : "0.0"}%`, swatch: RESOURCE_SWATCH.swap }} /><ResourceMetric dataKey="storage" label={t("serverDetail.disk")} used={info.disk_total ? t("serverDetail.usedAmount", { value: formatBytes(diskUsed) }) : undefined} total={info.disk_total ? t("serverDetail.totalAmount", { value: formatBytes(info.disk_total) }) : undefined} value={`${info.disk.toFixed(1)}%`} swatch={RESOURCE_SWATCH.storage} /><ResourceMetric label={t("serverDetail.load")} value={String(info.load_1)} swatch={RESOURCE_SWATCH.load} /></div></section>
          <section className="min-w-0 overflow-hidden rounded-[14px] border border-[var(--lite-line)] bg-[var(--lite-paper)] shadow-[0_1px_2px_rgba(28,37,46,0.03)]"><header className="px-5 py-4"><h3 className="m-0 text-[14px] font-semibold">{t("serverDetail.systemInfo")}</h3><p className="mt-1 text-[12px] text-[#919EAB]">{t("serverDetail.deviceConfig")}</p></header><div className="grid grid-cols-2 gap-x-5 px-5 pb-2 max-[620px]:grid-cols-1"><InfoCell label={t("serverDetail.runtimeInfo")} value={uptime} /><InfoCell label={t("serverDetailChart.process")} value={String(info.process)} /><InfoCell label="TCP" value={String(info.tcp)} /><InfoCell label="UDP" value={String(info.udp)} /><InfoCell label={t("serverDetail.load")} value={`${info.load_1} / ${info.load_5} / ${info.load_15}`} /><InfoCell label={t("serverDetail.lastActive")} value={info.last_active_time_string || "--"} wrap /></div></section>
        </div>
      </div>

      <section aria-labelledby="resource-history-title">
        <header className="mb-3 flex min-h-8 items-center justify-between gap-4">
          <h2 id="resource-history-title" className="m-0 text-[14px] font-semibold text-[#1C252E] dark:text-white">{t("serverDetail.resourceTrend")}</h2>
          <Select
            size="small"
            value={String(hours)}
            onChange={(event) => setHours(Number(event.target.value))}
            aria-label={t("monitor.timeRange")}
            sx={{ width: 78, height: 32, fontSize: 12, borderRadius: "6px" }}
          >
            {HISTORY_TIME_OPTIONS.map((option) => (
              <MenuItem key={option.value} value={String(option.value)}>{option.label}</MenuItem>
            ))}
          </Select>
        </header>
        <div className="grid grid-cols-1 gap-3 min-[720px]:grid-cols-2 min-[1101px]:grid-cols-4">
          <ResourceHistoryCard
            label="CPU"
            dataKey="cpu"
            hours={hours}
            chartData={chartData}
            isLoading={isPending}
            series={[{ key: "cpu", label: "CPU", color: RESOURCE_COLORS.cpu }]}
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
            label={t("serverDetail.disk")}
            dataKey="storage"
            hours={hours}
            chartData={chartData}
            isLoading={isPending}
            series={[{ key: "storage", label: t("serverDetail.disk"), color: RESOURCE_COLORS.storage }]}
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
