"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { useWebSocketContext } from "@/hooks/use-websocket-context"
import { fetchMonitor } from "@/lib/lite-api"
import { HISTORY_TIME_OPTIONS, historyRefetchMs, probeHistoryMaxPoints } from "@/lib/history-range"
import { readHomeLatencyCache } from "@/lib/home-latency"
import { selectedTaskSampleCount } from "@/lib/probe-samples"
import { pickBestProbeTask } from "@/lib/probe-route"
import { monitorNameForId, nextActiveCharts } from "@/lib/probe-chart-selection"
import { MONITOR_STALE_TIME_MS, monitorQueryKey } from "@/lib/prefetch-monitor"
import { monitorsFromHomeLatency } from "@/lib/ping-display"
import { readDefaultProbeChartHours } from "@/lib/theme-config"
import { cn, formatTime, parseLiteWebsocketMessage } from "@/lib/utils"
import { formatCompactTime } from "@/lib/format"
import {
  computeMissingBands,
  decorateChartRows,
  lossLaneKey,
  lossMarkers,
  pingTooltipModel,
  sampleCompleteness,
  type ChartRow,
  type PingGapSeries,
} from "@/lib/ping-gaps"
import { PROBE_COLORS } from "@/lib/theme-tokens"
import { LiteMonitor, ServerMonitorChart } from "@/types/lite-api"
import { useQuery } from "@tanstack/react-query"
import { Button, Chip, MenuItem, Select, Table, TableBody, TableCell, TableContainer, TableHead, TableRow } from "@mui/material"
import { Activity, Radar, Route, ShieldCheck } from "lucide-react"
import * as React from "react"
import { useCallback, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { Area, CartesianGrid, ComposedChart, Line, ReferenceArea, XAxis, YAxis } from "recharts"

import { LoadingSpinner } from "./loading/Loader"

interface ResultItem {
  created_at: number
  [key: string]: number | null
}

/**
 * Helper method to calculate packet loss from delay data
 */
const calculatePacketLoss = (delays: Array<number | null>): number[] => {
  if (!delays || delays.length === 0) return []

  const packetLossRates: number[] = []
  const windowSize = Math.min(10, Math.max(3, Math.floor(delays.length / 10)))
  const timeoutThreshold = 3000
  const extremeDelayThreshold = 10000

  for (let i = 0; i < delays.length; i++) {
    const currentDelay = delays[i]
    let lossRate = 0

    if (currentDelay === 0 || currentDelay === null || currentDelay === undefined) {
      lossRate = 100
    } else if (currentDelay >= extremeDelayThreshold) {
      lossRate = Math.min(95, 60 + (currentDelay - extremeDelayThreshold) / 1000)
    } else if (currentDelay >= timeoutThreshold) {
      lossRate = Math.min(50, (currentDelay - timeoutThreshold) / 200)
    } else {
      const start = Math.max(0, i - Math.floor(windowSize / 2))
      const end = Math.min(delays.length, i + Math.ceil(windowSize / 2))
      const windowDelays = delays.slice(start, end).filter((delay): delay is number => delay !== null && delay > 0)

      if (windowDelays.length > 2) {
        const mean = windowDelays.reduce((sum, d) => sum + d, 0) / windowDelays.length
        const variance = windowDelays.reduce((sum, d) => sum + (d - mean) ** 2, 0) / windowDelays.length
        const standardDeviation = Math.sqrt(variance)
        const coefficientOfVariation = standardDeviation / mean

        if (coefficientOfVariation > 0.8) {
          lossRate = Math.min(25, coefficientOfVariation * 15)
        } else if (coefficientOfVariation > 0.5) {
          lossRate = Math.min(10, coefficientOfVariation * 8)
        } else if (coefficientOfVariation > 0.3) {
          lossRate = Math.min(5, coefficientOfVariation * 5)
        }

        if (currentDelay > mean * 2.5) {
          lossRate += Math.min(15, (currentDelay / mean - 2.5) * 10)
        }
      }
    }

    if (i > 0) {
      const alpha = 0.3
      lossRate = alpha * lossRate + (1 - alpha) * packetLossRates[i - 1]
    }

    packetLossRates.push(Math.max(0, Math.min(100, lossRate)))
  }

  return packetLossRates.map((rate) => Number(rate.toFixed(2)))
}

type MonitorPoint = ServerMonitorChart[string][number]

type MonitorTaskSummary = {
  name: string
  currentDelay: number | null
  averageDelay: number | null
  packetLoss: number | null
  availability: number | null
  lastUpdated: number | null
  firstTime: number | null
  samples: number
  healthy: boolean
}

function finiteMetric(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value)
}

function summarizeMonitorTask(name: string, points: MonitorPoint[]): MonitorTaskSummary {
  const validDelays = points.map((point) => point.avg_delay).filter(finiteMetric)
  const latest = points.at(-1)
  const currentDelay = finiteMetric(latest?.avg_delay) ? latest.avg_delay : null
  let weightedLoss = 0
  let samples = 0

  for (const point of points) {
    const count = finiteMetric(point.sample_count) && point.sample_count > 0 ? point.sample_count : 1
    const loss = finiteMetric(point.packet_loss) ? Math.min(100, Math.max(0, point.packet_loss)) : 0
    weightedLoss += loss * count
    samples += count
  }

  const packetLoss = samples > 0 ? weightedLoss / samples : null
  return {
    name,
    currentDelay,
    averageDelay: validDelays.length > 0 ? validDelays.reduce((sum, value) => sum + value, 0) / validDelays.length : null,
    packetLoss,
    availability: packetLoss === null ? null : Math.max(0, 100 - packetLoss),
    lastUpdated: latest?.created_at || null,
    firstTime: points[0]?.created_at ?? null,
    samples,
    healthy: currentDelay !== null && (packetLoss === null || packetLoss < 100),
  }
}

function formatDelay(value: number | null): string {
  return value === null ? "--" : `${Math.round(value)} ms`
}

function formatPercentage(value: number | null, digits = 1): string {
  return value === null ? "--" : `${value.toFixed(digits)}%`
}

function isNarrowScreen(): boolean {
  return typeof window !== "undefined" && window.innerWidth < 640
}

function formatCompleteness(value: number | null | undefined): string {
  return value === null || value === undefined ? "--" : formatPercentage(value * 100, 0)
}

export function NetworkChart({ server_id, show, initialMonitorId }: { server_id: number; show: boolean; initialMonitorId?: number }) {
  const { t } = useTranslation()
  const { lastMessage } = useWebSocketContext()
  const [hours, setHours] = React.useState<number>(readDefaultProbeChartHours)

  const fallbackServer = useMemo(() => {
    if (!lastMessage) return undefined
    return parseLiteWebsocketMessage(lastMessage.data)?.servers.find((server) => server.id === server_id)
  }, [lastMessage, server_id])
  const fallbackServerName = fallbackServer?.name || ""
  const homePlaceholder = useMemo(() => {
    const uuid = fallbackServer?.uuid
    if (!uuid) return undefined
    const cached = readHomeLatencyCache(window.sessionStorage, [uuid])
    const summaries = cached?.[uuid]
    if (!summaries?.length) return undefined
    return { success: true, data: monitorsFromHomeLatency(summaries, server_id, fallbackServerName) }
  }, [fallbackServer, fallbackServerName, server_id])

  const {
    data: monitorData,
    isPending,
    isFetching,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: monitorQueryKey(server_id, hours),
    queryFn: () => fetchMonitor(server_id, hours),
    placeholderData: (previous) => previous ?? homePlaceholder,
    enabled: true,
    refetchOnWindowFocus: false,
    refetchInterval: show ? historyRefetchMs(hours) : false,
    staleTime: MONITOR_STALE_TIME_MS,
  })

  const monitorRecords = monitorData?.data || []
  const hasTasks = monitorRecords.length > 0
  const hasSamples = monitorRecords.some((monitor) => monitor.created_at.length > 0)
  const waitingForChart = isFetching && !hasSamples
  const isLoading = waitingForChart || (isPending && !hasTasks)
  const hasInitialError = isError && !monitorData
  const isEmpty = !isLoading && !hasInitialError && !!monitorData?.success && !hasTasks

  React.useEffect(() => {
    if (hasInitialError) console.error("Failed to load ping monitor data:", error)
  }, [error, hasInitialError])
  const transformedData = monitorRecords.length > 0 ? transformData(monitorRecords) : {}
  const taskIntervals = monitorRecords.reduce<Record<string, number | null | undefined>>((acc, monitor) => {
    acc[monitor.monitor_name] = monitor.interval
    return acc
  }, {})
  // Downsampled windows return one point per bucket, so a bucket is the smallest step we can judge gaps by.
  const bucketMs = (hours * 3_600_000) / probeHistoryMaxPoints(hours)

  const formattedData = hasSamples ? formatData(monitorRecords) : []
  const initialChart = monitorNameForId(monitorRecords, initialMonitorId)

  const chartDataKey = Object.keys(transformedData).length > 0
    ? Object.keys(transformedData)
    : monitorRecords.map((monitor) => monitor.monitor_name).filter(Boolean)

  const initChartConfig = {
    avg_delay: {
      label: t("monitor.avgDelay"),
    },
    ...chartDataKey.reduce((acc, key) => {
      acc[key] = {
        label: key,
      }
      return acc
    }, {} as ChartConfig),
  } satisfies ChartConfig

  return (
    <NetworkChartClient
      chartDataKey={chartDataKey}
      chartConfig={initChartConfig}
      chartData={transformedData}
      serverName={monitorRecords[0]?.server_name || fallbackServerName}
      formattedData={formattedData}
      taskIntervals={taskIntervals}
      bucketMs={bucketMs}
      hours={hours}
      isLoading={isLoading}
      isEmpty={isEmpty}
      hasError={hasInitialError}
      initialChart={initialChart}
      onHoursChange={setHours}
      onRetry={() => void refetch()}
    />
  )
}

export const NetworkChartClient = React.memo(function NetworkChart({
  chartDataKey,
  chartConfig,
  chartData,
  serverName,
  formattedData,
  taskIntervals,
  bucketMs,
  hours,
  isLoading,
  isEmpty,
  hasError,
  initialChart,
  onHoursChange,
  onRetry,
}: {
  chartDataKey: string[]
  chartConfig: ChartConfig
  chartData: ServerMonitorChart
  serverName: string
  formattedData: ResultItem[]
  taskIntervals: Record<string, number | null | undefined>
  bucketMs: number
  hours: number
  isLoading: boolean
  isEmpty: boolean
  hasError: boolean
  initialChart?: string
  onHoursChange: (hours: number) => void
  onRetry: () => void
}) {
  const { t } = useTranslation()
  const hasTasks = chartDataKey.length > 0
  const hasChartData = !isLoading && !hasError && formattedData.length > 0
  const showTaskLayout = hasTasks && !hasError

  const customBackgroundImage = (window.CustomBackgroundImage as string) !== "" ? window.CustomBackgroundImage : undefined

  const forcePeakCutEnabled = (window.ForcePeakCutEnabled as boolean) ?? false

  const [activeCharts, setActiveCharts] = React.useState<string[]>(() => (initialChart ? [initialChart] : []))
  const initializedChartKeys = React.useRef("")
  const appliedInitialChart = React.useRef<string | undefined>(undefined)
  const activeChartsRef = React.useRef<string[]>([])
  activeChartsRef.current = activeCharts
  const isPeakEnabled = forcePeakCutEnabled

  React.useEffect(() => {
    const next = nextActiveCharts({
      chartDataKey,
      initialChart,
      initializedSignature: initializedChartKeys.current,
      appliedInitial: appliedInitialChart.current,
      previous: activeChartsRef.current,
    })
    if (next.skip) return
    initializedChartKeys.current = next.signature
    appliedInitialChart.current = next.appliedInitial
    setActiveCharts(next.charts)
  }, [chartDataKey, initialChart])

  const toggleChart = useCallback((name: string) => {
    setActiveCharts((previous) => {
      if (previous.includes(name)) {
        if (previous.length === 1) return previous
        return previous.filter((chart) => chart !== name)
      }
      return [...previous, name]
    })
  }, [])

  const selectAllCharts = useCallback(() => setActiveCharts([...chartDataKey]), [chartDataKey])

  const getColorByIndex = useCallback(
    (chart: string) => {
      const index = chartDataKey.indexOf(chart)
      return PROBE_COLORS[index % PROBE_COLORS.length]
    },
    [chartDataKey],
  )

  const taskSummaries = useMemo(
    () => chartDataKey.map((name) => summarizeMonitorTask(name, chartData[name] || [])),
    [chartData, chartDataKey],
  )

  const selectedTaskSummaries = useMemo(
    () => taskSummaries.filter((summary) => activeCharts.includes(summary.name)),
    [activeCharts, taskSummaries],
  )

  const overviewMetrics = useMemo(() => {
    const delays = selectedTaskSummaries.map((summary) => summary.averageDelay).filter(finiteMetric)
    const currentDelays = selectedTaskSummaries.map((summary) => summary.currentDelay).filter(finiteMetric)
    const sampleCount = selectedTaskSampleCount(selectedTaskSummaries.map((summary) => summary.samples))
    const sampleWeight = selectedTaskSummaries.reduce((sum, summary) => sum + summary.samples, 0)
    const weightedLoss = selectedTaskSummaries.reduce(
      (sum, summary) => sum + (summary.packetLoss ?? 0) * summary.samples,
      0,
    )
    const packetLoss = sampleWeight > 0 ? weightedLoss / sampleWeight : null
    const bestTask = pickBestProbeTask(selectedTaskSummaries)
    const lastUpdated = selectedTaskSummaries.reduce<number | null>(
      (latest, summary) => summary.lastUpdated !== null && (latest === null || summary.lastUpdated > latest) ? summary.lastUpdated : latest,
      null,
    )

    return {
      averageDelay: delays.length > 0 ? delays.reduce((sum, value) => sum + value, 0) / delays.length : null,
      currentDelay: currentDelays.length > 0 ? currentDelays.reduce((sum, value) => sum + value, 0) / currentDelays.length : null,
      packetLoss,
      availability: packetLoss === null ? null : Math.max(0, 100 - packetLoss),
      sampleCount,
      bestTask,
      lastUpdated,
    }
  }, [selectedTaskSummaries])

  // "Now" is re-read whenever fresh data arrives, so the tail of the chart is judged against the present.
  const now = useMemo(() => Date.now(), [chartData])

  const gapSeries = useMemo<PingGapSeries[]>(
    () =>
      activeCharts.map((name) => ({
        key: name,
        intervalSec: taskIntervals[name],
        points: (chartData[name] || []).map((point) => ({ time: point.created_at, lost: point.lost })),
      })),
    [activeCharts, chartData, taskIntervals],
  )
  const missingBands = useMemo(() => computeMissingBands(gapSeries, { now, minStepMs: bucketMs }), [gapSeries, now, bucketMs])
  const markers = useMemo(() => lossMarkers(gapSeries), [gapSeries])

  const tooltipModelAt = useCallback(
    (time: number) => pingTooltipModel({ time, bands: missingBands, series: gapSeries, formatTime }),
    [missingBands, gapSeries],
  )

  const completenessByTask = useMemo(() => {
    const result: Record<string, number | null> = {}
    for (const summary of taskSummaries) {
      result[summary.name] = sampleCompleteness({
        records: summary.samples,
        firstTime: summary.firstTime,
        windowEnd: now,
        intervalSec: taskIntervals[summary.name],
      })
    }
    return result
  }, [taskSummaries, taskIntervals, now])

  const chartElements = useMemo(() => {
    const elements = []

    // Grey bands: no task has any record here (usually the node lost its link to the panel).
    missingBands.forEach((band) => {
      elements.push(
        <ReferenceArea
          key={`missing-${band.start}`}
          yAxisId="delay"
          x1={band.start}
          x2={band.end}
          fill="#919EAB"
          fillOpacity={0.18}
          stroke="none"
          ifOverflow="visible"
        />,
      )
    })

    // If exactly one chart is selected, show delay line and packet loss area
    if (activeCharts.length === 1) {
      const chart = activeCharts[0]
      elements.push(
        <Area
          key="packet-loss-area"
          isAnimationActive={false}
          dataKey="packet_loss"
          stroke="none"
          fill="hsl(45, 100%, 60%)"
          fillOpacity={0.3}
          yAxisId="packet-loss"
        />,
        <Line
          key="delay-line"
          isAnimationActive={false}
          strokeWidth={1.4}
          type="linear"
          dot={false}
          dataKey="avg_delay"
          stroke={getColorByIndex(chart)}
          yAxisId="delay"
          connectNulls={false}
        />,
      )
    } else if (activeCharts.length > 1) {
      // Multiple charts selected - show only delay lines for selected monitors
      elements.push(
        ...activeCharts.map((chart) => (
          <Line
            key={chart}
            isAnimationActive={false}
            strokeWidth={1.4}
            type="linear"
            dot={false}
            dataKey={chart}
            stroke={getColorByIndex(chart)}
            name={chart}
            connectNulls={false}
            yAxisId="delay"
          />
        )),
      )
    } else {
      // No selection - show all charts (default view)
      elements.push(
        ...chartDataKey.map((key) => (
          <Line
            key={key}
            isAnimationActive={false}
            strokeWidth={1.4}
            type="linear"
            dot={false}
            dataKey={key}
            stroke={getColorByIndex(key)}
            connectNulls={false}
            yAxisId="delay"
          />
        )),
      )
    }

    // The band hover text rides on an invisible line that sits on its own hidden axis.
    elements.push(
      <Line
        key="gap-band"
        isAnimationActive={false}
        dataKey="gap_band"
        name="gap_band"
        yAxisId="marker"
        stroke="none"
        dot={false}
        activeDot={false}
        connectNulls={false}
      />,
    )

    // One small lane of dots per displayed task in the task's own colour, drawn last so it stays on top.
    activeCharts.forEach((name) => {
      const color = getColorByIndex(name)
      elements.push(
        <Line
          key={`loss-lane-${name}`}
          isAnimationActive={false}
          dataKey={lossLaneKey(name)}
          yAxisId="marker"
          stroke="none"
          activeDot={false}
          connectNulls={false}
          tooltipType="none"
          dot={(props: { cx?: number; cy?: number; index?: number; payload?: Record<string, unknown> }) =>
            typeof props.payload?.[lossLaneKey(name)] === "number" ? (
              <circle key={`loss-${name}-${props.index}`} cx={props.cx} cy={props.cy} r={isNarrowScreen() ? 1.6 : 2.6} fill={color} />
            ) : (
              <g key={`loss-${name}-${props.index}`} />
            )
          }
        />,
      )
    })

    return elements
  }, [activeCharts, chartDataKey, getColorByIndex, missingBands])

  const smoothedData = useMemo(() => {
    // Special handling for single chart selection
    let baseData = formattedData
    if (activeCharts.length === 1) {
      const selectedChart = activeCharts[0]
      const selectedData = chartData[selectedChart]
      if (selectedData) {
        baseData = selectedData.map((item) => ({
          created_at: item.created_at,
          avg_delay: item.avg_delay,
          packet_loss: item.packet_loss ?? 0,
        }))
      }
    }

    if (!isPeakEnabled) {
      return baseData
    }

    // For peak cutting, use the base data
    const data = baseData

    const windowSize = 11 // 增加窗口大小以获取更好的统计效果
    const alpha = 0.3 // EWMA平滑因子

    // 辅助函数：计算中位数
    const getMedian = (arr: number[]) => {
      const sorted = [...arr].sort((a, b) => a - b)
      const mid = Math.floor(sorted.length / 2)
      return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
    }

    // 辅助函数：异常值处理
    const processValues = (values: number[]) => {
      if (values.length === 0) return null

      const median = getMedian(values)
      const deviations = values.map((v) => Math.abs(v - median))
      const medianDeviation = getMedian(deviations) * 1.4826 // MAD估计器

      // 使用中位数绝对偏差(MAD)进行异常值检测
      const validValues = values.filter(
        (v) =>
          Math.abs(v - median) <= 3 * medianDeviation && // 更严格的异常值判定
          v <= median * 3, // 限制最大值不超过中位数的3倍
      )

      if (validValues.length === 0) return median // 如果没有有效值，返回中位数

      // 计算EWMA
      let ewma = validValues[0]
      for (let i = 1; i < validValues.length; i++) {
        ewma = alpha * validValues[i] + (1 - alpha) * ewma
      }

      return ewma
    }

    // 初始化EWMA历史值
    const ewmaHistory: { [key: string]: number } = {}

    return data.map((point, index) => {
      if (index < windowSize - 1) return point

      const window = data.slice(index - windowSize + 1, index + 1)
      const smoothed = { ...point } as ResultItem

      // Special handling for single chart selection
      if (activeCharts.length === 1) {
        if (point.avg_delay === null || point.avg_delay === undefined) return smoothed

        // Process avg_delay for single chart
        const values = window.map((w) => w.avg_delay as number).filter((v) => v !== undefined && v !== null)

        if (values.length > 0) {
          const processed = processValues(values)
          if (processed !== null) {
            if (ewmaHistory.avg_delay === undefined) {
              ewmaHistory.avg_delay = processed
            } else {
              ewmaHistory.avg_delay = alpha * processed + (1 - alpha) * ewmaHistory.avg_delay
            }
            smoothed.avg_delay = ewmaHistory.avg_delay
          }
        }
      } else {
        // Process all chart keys or just the selected ones
        const keysToProcess = activeCharts.length > 0 ? activeCharts : chartDataKey

        keysToProcess.forEach((key) => {
          if (point[key] === null || point[key] === undefined) return

          const values = window.map((w) => w[key]).filter((v) => v !== undefined && v !== null) as number[]

          if (values.length > 0) {
            const processed = processValues(values)
            if (processed !== null) {
              // Apply EWMA smoothing
              if (ewmaHistory[key] === undefined) {
                ewmaHistory[key] = processed
              } else {
                ewmaHistory[key] = alpha * processed + (1 - alpha) * ewmaHistory[key]
              }
              smoothed[key] = ewmaHistory[key]
            }
          }
        })
      }

      return smoothed
    })
  }, [isPeakEnabled, activeCharts, formattedData, chartData, chartDataKey])

  const processedData = useMemo(
    () => decorateChartRows(smoothedData as ChartRow[], { keys: activeCharts, markers, bands: missingBands }) as ResultItem[],
    [smoothedData, activeCharts, markers, missingBands],
  )
  const xDomainEnd = useMemo(() => {
    const lastRow = smoothedData.reduce((max, row) => Math.max(max, row.created_at), Number.NEGATIVE_INFINITY)
    return missingBands.reduce((max, band) => Math.max(max, band.end), lastRow)
  }, [smoothedData, missingBands])

  return (
    <div
      aria-busy={isLoading}
      data-state={isLoading ? "loading" : hasError ? "error" : isEmpty ? "empty" : "ready"}
      className="flex flex-col gap-3"
    >
      <Card className={cn("overflow-hidden rounded-[14px] border-[var(--lite-line)] shadow-[0_1px_2px_rgba(28,37,46,0.03)]", { "bg-card/70": customBackgroundImage })}>
        <CardHeader className={cn("flex flex-row items-start justify-between gap-2 space-y-0 px-5 py-4", showTaskLayout && "min-h-[56px]")}>
          <div className="flex min-w-0 flex-1 items-start gap-2.5">
            <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full leading-none" style={{ color: "#4C8FD4", background: "color-mix(in srgb, #4C8FD4 var(--lite-tint), transparent)" }}>
              <Radar className="block size-3.5" strokeWidth={1.75} />
            </span>
            <div className="min-w-0">
              <CardTitle className="truncate text-[14px]">{t("monitor.overview")}</CardTitle>
              {showTaskLayout ? (
                <p className="mt-1 truncate text-[12px] font-normal text-[#919EAB]">
                  {`${serverName || "--"} · ${t("monitor.selectedTasks")} ${activeCharts.length}/${chartDataKey.length || 0}`}
                </p>
              ) : null}
            </div>
          </div>
          {showTaskLayout ? (
            <Button size="small" variant="text" onClick={selectAllCharts} sx={{ height: 30, px: 1, fontSize: 12, flexShrink: 0 }}>
              {t("monitor.allTasks")}
            </Button>
          ) : null}
        </CardHeader>
        {showTaskLayout ? (
          <>
            <div className="flex flex-wrap gap-1.5 px-5 pb-3">
              {chartDataKey.map((name) => {
                const selected = activeCharts.includes(name)
                return (
                  <Chip
                    key={name}
                    clickable
                    onClick={() => toggleChart(name)}
                    aria-pressed={selected}
                    label={name}
                    className="task-chip"
                    sx={{
                      height: 27,
                      fontSize: 11,
                      borderRadius: "6px",
                      maxWidth: "100%",
                      border: selected ? "1px solid #078DEE" : "1px solid var(--lite-line)",
                      bgcolor: selected ? "rgba(7,141,238,0.10)" : "var(--lite-soft)",
                      color: selected ? "#078DEE" : "#637381",
                      ".dark &": { color: selected ? "#68B0F5" : "#C4CDD5" },
                    }}
                  />
                )
              })}
            </div>
            <CardContent className="grid grid-cols-2 gap-3 px-5 pb-5 pt-0 sm:grid-cols-4">
              {[
                [t("monitor.task"), hasChartData ? `${activeCharts.length}/${chartDataKey.length}` : "--"],
                [t("monitor.avgDelayFull"), hasChartData ? formatDelay(overviewMetrics.averageDelay) : "--"],
                [t("monitor.packetLoss"), hasChartData ? formatPercentage(overviewMetrics.packetLoss) : "--"],
                [t("monitor.availability"), hasChartData ? formatPercentage(overviewMetrics.availability, 2) : "--"],
              ].map(([label, value]) => (
                <div key={label} className="min-w-0 rounded-[12px] bg-[var(--lite-soft)] px-3.5 py-3">
                  <p className="text-[11px] text-[#919EAB]">{label}</p>
                  <strong className="mt-2 block truncate text-[20px] font-semibold tabular-nums text-[#1C252E] dark:text-white">{value}</strong>
                </div>
              ))}
            </CardContent>
          </>
        ) : (
          <CardContent className="flex min-h-[120px] items-center justify-center px-4 py-8">
            {isLoading ? (
              <div className="text-muted-foreground" aria-label={t("common.loading")}><LoadingSpinner /></div>
            ) : hasError ? (
              <div className="flex flex-col items-center gap-3 text-center">
                <p className="text-sm font-normal text-muted-foreground">{t("monitor.loadError")}</p>
                <Button size="small" variant="outlined" onClick={onRetry}>{t("monitor.retry")}</Button>
              </div>
            ) : (
              <p className="text-sm font-normal text-muted-foreground">{t("monitor.noData")}</p>
            )}
          </CardContent>
        )}
      </Card>

      <Card data-testid="network-chart-card" className={cn("overflow-hidden rounded-[14px] border-[var(--lite-line)] shadow-[0_1px_2px_rgba(28,37,46,0.03)]", { "bg-card/70": customBackgroundImage })}>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 px-5 py-4">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full" style={{ color: "#22C55E", background: "color-mix(in srgb, #22C55E var(--lite-tint), transparent)" }}>
              <Activity className="size-3.5" strokeWidth={1.75} />
            </span>
            <div className="min-w-0">
              <CardTitle className="truncate text-[14px]">{t("monitor.allLatency")}</CardTitle>
              {showTaskLayout ? (
                <div className="mt-1 flex max-w-full flex-wrap items-center gap-x-3 gap-y-1">
                  {activeCharts.slice(0, 4).map((name) => (
                    <span key={name} className="flex min-w-0 items-center gap-1 text-[12px] text-[#919EAB]">
                      <i className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: getColorByIndex(name) }} />
                      <span className="max-w-24 truncate">{name}</span>
                    </span>
                  ))}
                  {activeCharts.length > 4 && <span className="text-[12px] text-[#919EAB]">+{activeCharts.length - 4}</span>}
                </div>
              ) : null}
              {showTaskLayout ? (
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-[#919EAB]" data-testid="network-chart-gap-legend">
                  <span className="flex items-center gap-1">
                    <i className="size-1.5 shrink-0 rounded-full bg-[#919EAB]" />
                    {t("monitor.legendLoss")}
                  </span>
                  <span className="flex items-center gap-1">
                    <i className="size-2 shrink-0 rounded-[2px] bg-[#919EAB]/30" />
                    {t("monitor.legendGap")}
                  </span>
                </p>
              ) : null}
            </div>
          </div>
          {showTaskLayout ? (
            <Select
              size="small"
              value={String(hours)}
              onChange={(event) => onHoursChange(Number(event.target.value))}
              aria-label={t("monitor.timeRange")}
              sx={{ width: 78, height: 32, fontSize: 12, flexShrink: 0 }}
            >
              {HISTORY_TIME_OPTIONS.map((option) => <MenuItem key={option.value} value={String(option.value)}>{option.label}</MenuItem>)}
            </Select>
          ) : null}
        </CardHeader>
        {showTaskLayout ? (
          <CardContent className="px-5 pb-5 pt-1">
            <div className={cn("relative overflow-hidden", hasChartData ? "h-[220px] sm:h-[280px]" : "h-[150px] sm:h-[200px]")}>
              <ChartContainer
                aria-hidden={!hasChartData}
                config={chartConfig}
                data-testid="network-chart-canvas"
                className={cn(
                  "aspect-auto h-full w-full transition-opacity duration-150 motion-reduce:transition-none",
                  hasChartData ? "opacity-100" : "pointer-events-none absolute inset-0 opacity-0",
                )}
              >
                <ComposedChart data={hasChartData ? processedData : []} margin={{ left: 12, right: 12 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="created_at"
                    type="number"
                    scale="time"
                    domain={["dataMin", Number.isFinite(xDomainEnd) ? xDomainEnd : "dataMax"]}
                    tickLine
                    tickSize={3}
                    axisLine={false}
                    tickMargin={8}
                    minTickGap={80}
                    tickFormatter={(value) => {
                      const date = new Date(value)
                      const minutes = date.getMinutes().toString().padStart(2, "0")
                      return `${date.getHours()}:${minutes}`
                    }}
                  />
                  <YAxis yAxisId="marker" hide domain={[0, 1]} />
                  <YAxis yAxisId="delay" tickLine={false} axisLine={false} tickMargin={15} minTickGap={20} tickFormatter={(value) => `${value}ms`} />
                  {activeCharts.length === 1 && (
                    <YAxis yAxisId="packet-loss" orientation="right" tickLine={false} axisLine={false} tickMargin={15} minTickGap={20} tickFormatter={(value) => `${value}%`} />
                  )}
                  <ChartTooltip
                    isAnimationActive={false}
                    defaultIndex={undefined}
                    trigger="hover"
                    content={(tooltipProps) => (
                      <ChartTooltipContent
                        active={tooltipProps.active}
                        label={tooltipProps.label}
                        payload={tooltipProps.payload?.filter((item) => !String(item.dataKey).startsWith("loss__"))}
                        indicator="line"
                        labelKey="created_at"
                        labelFormatter={(_, payload) => {
                          const model = tooltipModelAt(payload[0].payload.created_at as number)
                          return (
                            <div className="grid gap-1">
                              <span>{model.label}</span>
                              {model.lines.map((line) =>
                                line.kind === "loss" ? (
                                  <span key="loss" className="flex flex-wrap items-center gap-x-1 text-[12px] font-normal">
                                    <span>{t("monitor.lossPrefix")}</span>
                                    {line.keys.map((name, index) => (
                                      <span key={name} className="flex items-center gap-1">
                                        <i className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: getColorByIndex(name) }} />
                                        {name}
                                        {index < line.keys.length - 1 ? t("monitor.listSeparator") : ""}
                                      </span>
                                    ))}
                                  </span>
                                ) : null,
                              )}
                            </div>
                          )
                        }}
                        formatter={(value, name, item) => {
                          if (name === "gap_band") {
                            // A band row has a single item, so the tooltip drops its label: print the time here.
                            return (
                              <div className="grid flex-1 gap-1.5">
                                <span className="font-medium text-foreground">{tooltipModelAt(item.payload.created_at as number).label}</span>
                                <div className="flex items-center gap-1.5 leading-none">
                                  <i className="size-2 shrink-0 rounded-[2px] bg-[#919EAB]/40" />
                                  <span className="text-foreground">{t("monitor.noRecord")}</span>
                                </div>
                              </div>
                            )
                          }
                          const isLoss = name === "packet_loss"
                          const label = isLoss ? t("monitor.packetLoss") : name === "avg_delay" ? t("monitor.avgDelay") : String(name)
                          return (
                            <div className="flex flex-1 items-center justify-between leading-none">
                              <span className="text-muted-foreground">{label}</span>
                              <span className="ml-2 font-medium text-foreground tabular-nums">{Number(value).toFixed(2)}{isLoss ? "%" : "ms"}</span>
                            </div>
                          )
                        }}
                      />
                    )}
                  />
                  {chartElements}
                </ComposedChart>
              </ChartContainer>
              {!hasChartData && (
                <div className="absolute inset-0 flex items-center justify-center rounded-md bg-muted/25">
                  {isLoading ? (
                    <div className="text-muted-foreground" aria-label={t("common.loading")}><LoadingSpinner /></div>
                  ) : (
                    <p className="text-sm font-normal text-muted-foreground">{t("monitor.noSamples")}</p>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        ) : (
          <CardContent className="flex min-h-[120px] items-center justify-center px-4 py-8">
            {isLoading ? (
              <div className="text-muted-foreground" aria-label={t("common.loading")}><LoadingSpinner /></div>
            ) : hasError ? (
              <div className="flex flex-col items-center gap-3 text-center">
                <p className="text-sm font-normal text-muted-foreground">{t("monitor.loadError")}</p>
                <Button size="small" variant="outlined" onClick={onRetry}>{t("monitor.retry")}</Button>
              </div>
            ) : (
              <p className="text-sm font-normal text-muted-foreground">{t("monitor.noData")}</p>
            )}
          </CardContent>
        )}
      </Card>

      <Card className="overflow-hidden rounded-[14px] border-[var(--lite-line)] shadow-[0_1px_2px_rgba(28,37,46,0.03)]">
        <CardHeader className="flex flex-row items-center gap-2.5 space-y-0 px-5 py-4">
          <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full" style={{ color: "#22C55E", background: "color-mix(in srgb, #22C55E var(--lite-tint), transparent)" }}><ShieldCheck className="size-3.5" strokeWidth={1.75} /></span>
          <div>
            <CardTitle className="text-[14px]">{t("monitor.nodes")}</CardTitle>
            <p className="mt-1 text-[12px] font-normal text-[#919EAB]">{t("monitor.nodesHint")}</p>
          </div>
        </CardHeader>
        <TableContainer sx={{ overflow: "hidden" }} className="max-[620px]:hidden">
          <Table size="small" aria-label={t("monitor.nodesTable")} sx={{ tableLayout: "fixed", width: "100%" }}>
            <TableHead>
              <TableRow>
                {[
                  t("monitor.task"),
                  t("monitor.currentDelay"),
                  t("monitor.avgDelayFull"),
                  t("monitor.packetLoss"),
                  t("monitor.sampleCompleteness"),
                  t("monitor.lastUpdate"),
                ].map((label) => (
                  <TableCell
                    key={label}
                    sx={{
                      px: { xs: 0.75, sm: 1.5 },
                      py: 1,
                      fontSize: 11,
                      color: "text.secondary",
                      lineHeight: 1.25,
                      whiteSpace: "normal",
                      bgcolor: "var(--lite-soft)",
                    }}
                  >
                    {label}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {selectedTaskSummaries.length > 0 ? selectedTaskSummaries.map((summary) => (
                <TableRow key={summary.name} hover>
                  <TableCell sx={{ px: { xs: 0.75, sm: 1.5 }, py: 1, fontSize: 12, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis" }}>{summary.name}</TableCell>
                  <TableCell sx={{ px: { xs: 0.75, sm: 1.5 }, py: 1, fontSize: 12, whiteSpace: "nowrap" }}>{formatDelay(summary.currentDelay)}</TableCell>
                  <TableCell sx={{ px: { xs: 0.75, sm: 1.5 }, py: 1, fontSize: 12, whiteSpace: "nowrap" }}>{formatDelay(summary.averageDelay)}</TableCell>
                  <TableCell sx={{ px: { xs: 0.75, sm: 1.5 }, py: 1, fontSize: 12, whiteSpace: "nowrap" }}>{formatPercentage(summary.packetLoss)}</TableCell>
                  <TableCell sx={{ px: { xs: 0.75, sm: 1.5 }, py: 1, fontSize: 12, whiteSpace: "nowrap" }}>{formatCompleteness(completenessByTask[summary.name])}</TableCell>
                  <TableCell sx={{ px: { xs: 0.75, sm: 1.5 }, py: 1, fontSize: 11, color: "text.secondary", lineHeight: 1.25, whiteSpace: "normal" }}>{summary.lastUpdated === null ? "--" : formatCompactTime(summary.lastUpdated)}</TableCell>
                </TableRow>
              )) : (
                <TableRow><TableCell colSpan={6} align="center" sx={{ py: 5, fontSize: 12, color: "text.secondary" }}>{hasTasks ? t("monitor.noSamples") : t("monitor.noProbeData")}</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <div className="hidden max-[620px]:block">
          {selectedTaskSummaries.length > 0 ? selectedTaskSummaries.map((summary) => (
            <div key={summary.name} className="grid grid-cols-4 gap-x-2.5 gap-y-2.5 border-t border-[var(--lite-line)] px-[15px] py-3.5">
              <div className="col-span-3 min-w-0">
                <p className="truncate text-xs font-medium">{summary.name}</p>
              </div>
              <p className="text-right text-[9px] text-[#919EAB]">{summary.lastUpdated === null ? "--" : formatCompactTime(summary.lastUpdated)}</p>
              <div>
                <span className="mb-1 block text-[9px] text-[#919EAB]">{t("monitor.currentDelay")}</span>
                <b className="text-[17px] font-medium">{formatDelay(summary.currentDelay)}</b>
              </div>
              <div>
                <span className="mb-1 block text-[9px] text-[#919EAB]">{t("monitor.avgDelayFull")}</span>
                <b className="text-[17px] font-medium">{formatDelay(summary.averageDelay)}</b>
              </div>
              <div>
                <span className="mb-1 block text-[9px] text-[#919EAB]">{t("monitor.packetLoss")}</span>
                <b className="text-[17px] font-medium">{formatPercentage(summary.packetLoss)}</b>
              </div>
              <div>
                <span className="mb-1 block text-[9px] text-[#919EAB]">{t("monitor.sampleCompleteness")}</span>
                <b className="text-[17px] font-medium">{formatCompleteness(completenessByTask[summary.name])}</b>
              </div>
            </div>
          )) : (
            <p className="px-4 py-8 text-center text-xs text-[#919EAB]">{hasTasks ? t("monitor.noSamples") : t("monitor.noProbeData")}</p>
          )}
        </div>
      </Card>

      <Card className="overflow-hidden rounded-[14px] border-[var(--lite-line)] shadow-[0_1px_2px_rgba(28,37,46,0.03)]">
        <CardHeader className="flex flex-row items-center gap-2.5 space-y-0 px-5 py-4">
          <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full" style={{ color: "#7B6CC7", background: "color-mix(in srgb, #7B6CC7 var(--lite-tint), transparent)" }}><Route className="size-3.5" strokeWidth={1.75} /></span>
          <div>
            <CardTitle className="text-[14px]">{t("monitor.routeSummary")}</CardTitle>
            <p className="mt-1 text-[12px] font-normal text-[#919EAB]">{t("monitor.routeHint")}</p>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 px-5 pb-5 pt-0 sm:grid-cols-4">
          {[
            [t("monitor.bestTask"), overviewMetrics.bestTask?.name || "--"],
            [t("monitor.availability"), formatPercentage(overviewMetrics.bestTask?.availability ?? null, 2)],
            [t("monitor.sampleWindow"), `${hours}h / ${overviewMetrics.bestTask?.samples || "--"}`],
            [t("monitor.routeStatus"), overviewMetrics.bestTask?.healthy ? t("monitor.stable") : t("monitor.noStatus")],
          ].map(([label, value]) => (
            <div key={label} className="min-w-0 rounded-[12px] bg-[var(--lite-soft)] px-3.5 py-3">
              <p className="truncate whitespace-nowrap text-[11px] text-[#919EAB]">{label}</p>
              <strong className="mt-2 block truncate whitespace-nowrap text-[16px] font-semibold tabular-nums text-[#1C252E] dark:text-white">{value}</strong>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
})

const transformData = (data: LiteMonitor[]) => {
  const monitorData: ServerMonitorChart = {}

  data.forEach((item) => {
    const monitorName = item.monitor_name

    if (!monitorData[monitorName]) {
      monitorData[monitorName] = []
    }

    // Calculate packet loss from delay data if not provided
    const packetLoss = item.packet_loss || calculatePacketLoss(item.avg_delay)

    for (let i = 0; i < item.created_at.length; i++) {
      monitorData[monitorName].push({
        created_at: item.created_at[i],
        avg_delay: item.avg_delay[i],
        packet_loss: packetLoss[i],
        sample_count: item.sample_count?.[i],
        lost: item.lost?.[i],
      })
    }
  })

  return monitorData
}

const formatData = (rawData: LiteMonitor[]) => {
  const result: { [time: number]: ResultItem } = {}

  const allTimes = new Set<number>()
  rawData.forEach((item) => {
    item.created_at.forEach((time) => allTimes.add(time))
  })

  const allTimeArray = Array.from(allTimes).sort((a, b) => a - b)

  rawData.forEach((item) => {
    const { monitor_name, created_at, avg_delay } = item

    // Calculate packet loss if not provided
    const packetLoss = item.packet_loss || calculatePacketLoss(avg_delay)

    allTimeArray.forEach((time) => {
      if (!result[time]) {
        result[time] = { created_at: time }
      }

      const timeIndex = created_at.indexOf(time)
      result[time][monitor_name] = timeIndex !== -1 ? avg_delay[timeIndex] : null
      // Add packet loss data if available
      if (packetLoss) {
        result[time][`${monitor_name}_packet_loss`] = timeIndex !== -1 ? packetLoss[timeIndex] : null
      }
    })
  })

  return Object.values(result).sort((a, b) => a.created_at - b.created_at)
}
