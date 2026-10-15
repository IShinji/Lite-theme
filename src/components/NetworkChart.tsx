"use client"

import FitTaskChips from "@/components/FitTaskChips"
import HistoryTimePills from "@/components/HistoryTimePills"
import NetworkTaskPicker from "@/components/NetworkTaskPicker"
import { Card, CardContent } from "@/components/ui/card"
import { ChartConfig, ChartContainer, ChartTooltip } from "@/components/ui/chart"
import { useWebSocketContext } from "@/hooks/use-websocket-context"
import { fetchMonitor } from "@/lib/lite-api"
import { weightedSuccessDelay } from "@/lib/ping-sample"
import { historyRangeI18n, historyRefetchMs } from "@/lib/history-range"
import { readHomeLatencyCache } from "@/lib/home-latency"
import { retainFocusedTasks, toggleFocusedTask, visibleProbeTasks } from "@/lib/fit-chips"
import { clampPage, compactPageList, filterTasksByName, pageCount, paginateItems, unionTaskNames } from "@/lib/probe-task-picker"
import { selectedTaskSampleCount } from "@/lib/probe-samples"
import { pickBestProbeTask } from "@/lib/probe-route"
import { monitorNameForId, nextActiveCharts } from "@/lib/probe-chart-selection"
import { MONITOR_STALE_TIME_MS, monitorQueryKey } from "@/lib/prefetch-monitor"
import { monitorsFromHomeLatency } from "@/lib/ping-display"
import { readDefaultProbeChartHours } from "@/lib/theme-config"
import { cn, formatTime, parseLiteWebsocketMessage } from "@/lib/utils"
import { formatClockTime, formatCompactTime, formatDelayAxisTick } from "@/lib/format"
import {
  computeMissingBands,
  decorateChartRows,
  displayedSampleCompleteness,
  HOVER_ANCHOR_KEY,
  lossLaneKey,
  lossMarkers,
  networkHoverView,
  taskLinePoints,
  taskMissingBands,
  type ChartRow,
  type PingGapSeries,
} from "@/lib/ping-gaps"
import { PROBE_COLORS } from "@/lib/theme-tokens"
import { LiteMonitor, ServerMonitorChart } from "@/types/lite-api"
import { useQuery } from "@tanstack/react-query"
import { Button, useMediaQuery } from "@mui/material"
import { ChevronDown } from "lucide-react"
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
    averageDelay: weightedSuccessDelay(
      points.map((point) => ({
        delay: finiteMetric(point.avg_delay) ? point.avg_delay : null,
        count: point.sample_count,
        lossPercent: point.packet_loss,
      })),
    ),
    packetLoss,
    availability: packetLoss === null ? null : Math.max(0, 100 - packetLoss),
    lastUpdated: latest?.created_at || null,
    firstTime: points[0]?.created_at ?? null,
    samples,
    healthy: currentDelay !== null && (packetLoss === null || packetLoss < 100),
  }
}

function formatDelay(value: number | null): string {
  return value === null ? "--" : `${value.toFixed(2)} ms`
}

function isNarrowScreen(): boolean {
  return typeof window !== "undefined" && window.innerWidth < 640
}

function completenessPercent(value: number | null | undefined): number | null {
  return value === null || value === undefined ? null : value * 100
}

function SplitStrong({ value, digits, unit }: { value: number | null; digits: number; unit: string }) {
  if (value === null) return <strong>--</strong>
  return (
    <strong>
      {value.toFixed(digits)}
      <small>{unit}</small>
    </strong>
  )
}

function SplitText({ value, digits, unit }: { value: number | null; digits: number; unit: string }) {
  if (value === null) return "--"
  return (
    <>
      {value.toFixed(digits)}
      <small>{unit}</small>
    </>
  )
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
    dataUpdatedAt,
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
  const bucketMsByTask = monitorRecords.reduce<Record<string, number>>((acc, monitor) => {
    if (typeof monitor.bucket_seconds === "number" && monitor.bucket_seconds > 0) acc[monitor.monitor_name] = monitor.bucket_seconds * 1000
    return acc
  }, {})

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
      bucketMsByTask={bucketMsByTask}
      hours={hours}
      fetchedAt={dataUpdatedAt}
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
  bucketMsByTask,
  hours,
  fetchedAt,
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
  bucketMsByTask: Record<string, number>
  hours: number
  fetchedAt: number
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
  const [pickerOpen, setPickerOpen] = React.useState(false)
  const [pickerAnchor, setPickerAnchor] = React.useState<HTMLElement | null>(null)
  const [draftCharts, setDraftCharts] = React.useState<string[]>([])
  const [taskQuery, setTaskQuery] = React.useState("")
  const [tablePage, setTablePage] = React.useState(1)
  const [focusedTasks, setFocusedTasks] = React.useState<string[]>([])
  const phone = useMediaQuery("(max-width: 967px)")
  const pageSize = phone ? 3 : 6
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

  const visibleCharts = useMemo(
    () => visibleProbeTasks(activeCharts, focusedTasks),
    [activeCharts, focusedTasks],
  )

  React.useEffect(() => {
    setFocusedTasks((current) => retainFocusedTasks(current, activeCharts))
  }, [activeCharts])

  const toggleChart = useCallback((name: string) => {
    setDraftCharts((previous) => {
      if (previous.includes(name)) {
        if (previous.length === 1) return previous
        return previous.filter((chart) => chart !== name)
      }
      return [...previous, name]
    })
  }, [])

  const selectAllCharts = useCallback(() => setActiveCharts([...chartDataKey]), [chartDataKey])

  const openPicker = useCallback((anchor?: HTMLElement | null) => {
    setDraftCharts([...activeChartsRef.current])
    setTaskQuery("")
    setPickerAnchor(anchor ?? null)
    setPickerOpen(true)
  }, [])

  const closePicker = useCallback(() => {
    setPickerOpen(false)
    setTaskQuery("")
    setDraftCharts([])
  }, [])

  const applyDraft = useCallback(() => {
    if (draftCharts.length === 0) return
    if (draftCharts.length === chartDataKey.length && chartDataKey.every((name) => draftCharts.includes(name))) {
      selectAllCharts()
    } else {
      setActiveCharts(draftCharts)
    }
    setTablePage(1)
    closePicker()
  }, [chartDataKey, closePicker, draftCharts, selectAllCharts])

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
    () => taskSummaries.filter((summary) => visibleCharts.includes(summary.name)),
    [taskSummaries, visibleCharts],
  )
  const delayLabels = useMemo(
    () => Object.fromEntries(taskSummaries.map((summary) => [summary.name, formatDelay(summary.currentDelay)])),
    [taskSummaries],
  )
  const pages = pageCount(selectedTaskSummaries.length, pageSize)
  const safePage = clampPage(tablePage, selectedTaskSummaries.length, pageSize)
  const pagedSummaries = paginateItems(selectedTaskSummaries, safePage, pageSize)
  const pageItems = compactPageList(safePage, pages)
  const sampleRange = historyRangeI18n(hours)

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

  const now = fetchedAt > 0 ? fetchedAt : 0

  const gapSeries = useMemo<PingGapSeries[]>(
    () =>
      visibleCharts.map((name) => ({
        key: name,
        intervalSec: taskIntervals[name],
        bucketMs: bucketMsByTask[name] ?? 0,
        points: (chartData[name] || []).map((point) => ({ time: point.created_at, lost: point.lost })),
      })),
    [visibleCharts, chartData, taskIntervals, bucketMsByTask],
  )
  const missingBands = useMemo(() => computeMissingBands(gapSeries, { now }), [gapSeries, now])
  const markers = useMemo(() => lossMarkers(gapSeries), [gapSeries])

  const delayLineData = useMemo(() => {
    const keys = visibleCharts.length > 0 ? visibleCharts : chartDataKey
    const single = visibleCharts.length === 1
    const out: Record<string, Array<Record<string, number | null>>> = {}
    for (const name of keys) {
      const source = (chartData[name] || [])
        .filter((point) => Number.isFinite(point.created_at))
        .map((point) => ({ created_at: point.created_at, value: point.avg_delay ?? null }))
      const series = gapSeries.find((item) => item.key === name) ?? {
        key: name,
        intervalSec: taskIntervals[name],
        bucketMs: bucketMsByTask[name] ?? 0,
        points: source.map((point) => ({ time: point.created_at })),
      }
      const bands = taskMissingBands(series, { now })
      const line = taskLinePoints(source, bands, { peak: isPeakEnabled })
      out[name] = line.map((point) =>
        single ? { created_at: point.created_at, avg_delay: point.value } : { created_at: point.created_at, [name]: point.value },
      )
    }
    return out
  }, [visibleCharts, bucketMsByTask, chartData, chartDataKey, gapSeries, isPeakEnabled, now, taskIntervals])

  const completenessByTask = useMemo(() => {
    const result: Record<string, number | null> = {}
    for (const name of chartDataKey) {
      result[name] = displayedSampleCompleteness({
        points: (chartData[name] || []).map((point) => ({
          time: point.created_at,
          count: finiteMetric(point.sample_count) && point.sample_count > 0 ? point.sample_count : 1,
        })),
        windowEnd: now,
        intervalSec: taskIntervals[name],
        bucketMs: bucketMsByTask[name] ?? 0,
      })
    }
    return result
  }, [bucketMsByTask, chartData, chartDataKey, now, taskIntervals])

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

    if (visibleCharts.length === 1) {
      const chart = visibleCharts[0]
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
          data={delayLineData[chart]}
          dataKey="avg_delay"
          stroke={getColorByIndex(chart)}
          yAxisId="delay"
          connectNulls={false}
        />,
      )
    } else if (visibleCharts.length > 1) {
      // Multiple charts selected - show only delay lines for selected monitors
      elements.push(
        ...visibleCharts.map((chart) => (
          <Line
            key={chart}
            isAnimationActive={false}
            strokeWidth={1.4}
            type="linear"
            dot={false}
            data={delayLineData[chart]}
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
            data={delayLineData[key]}
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
    visibleCharts.forEach((name) => {
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
  }, [visibleCharts, chartDataKey, delayLineData, getColorByIndex, missingBands])

  const smoothedData = useMemo(() => {
    // Special handling for single chart selection
    let baseData = formattedData
    if (visibleCharts.length === 1) {
      const selectedChart = visibleCharts[0]
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
      if (visibleCharts.length === 1) {
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
        const keysToProcess = visibleCharts.length > 0 ? visibleCharts : chartDataKey

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
  }, [isPeakEnabled, visibleCharts, formattedData, chartData, chartDataKey])

  const processedData = useMemo(
    () => decorateChartRows(smoothedData as ChartRow[], { keys: visibleCharts, markers, bands: missingBands }) as ResultItem[],
    [smoothedData, visibleCharts, markers, missingBands],
  )
  const xDomainEnd = useMemo(() => {
    const lastRow = smoothedData.reduce((max, row) => Math.max(max, row.created_at), Number.NEGATIVE_INFINITY)
    return missingBands.reduce((max, band) => Math.max(max, band.end), lastRow)
  }, [smoothedData, missingBands])

  return (
    <div
      aria-busy={isLoading}
      data-state={isLoading ? "loading" : hasError ? "error" : isEmpty ? "empty" : "ready"}
      className="lite-monitor-page"
    >
      <section className={cn("lite-panel lite-monitor-summary", { "bg-card/70": customBackgroundImage })}>
        {showTaskLayout ? (
          <>
            <div className="lite-monitor-summary__picker">
              <div className="lite-monitor-summary__title">
                <h2 title={serverName || undefined}>{t("monitor.overview")}</h2>
                <span>{t("monitor.selectedRatio", { selected: visibleCharts.length, total: chartDataKey.length || 0 })}</span>
                <button type="button" className="lite-monitor-summary__choose" onClick={(event) => openPicker(event.currentTarget)}>
                  {t("monitor.selectTasks")}
                  <ChevronDown className="size-3.5" />
                </button>
              </div>
              <FitTaskChips
                names={activeCharts}
                colorOf={getColorByIndex}
                extraLabel={(count) => t("monitor.extraCount", { count })}
                selectedNames={focusedTasks}
                onSelect={(name) => setFocusedTasks((current) => toggleFocusedTask(current, name))}
                onMore={(event) => openPicker(event.currentTarget)}
              />
            </div>
            <div className="lite-monitor-summary__metrics">
              <div>
                <span>{t("monitor.avgDelayFull")}</span>
                <SplitStrong value={hasChartData ? overviewMetrics.averageDelay : null} digits={2} unit="ms" />
              </div>
              <div>
                <span>{t("monitor.packetLoss")}</span>
                <SplitStrong value={hasChartData ? overviewMetrics.packetLoss : null} digits={1} unit="%" />
              </div>
              <div>
                <span>{t("monitor.availability")}</span>
                <SplitStrong value={hasChartData ? overviewMetrics.availability : null} digits={2} unit="%" />
              </div>
            </div>
            <NetworkTaskPicker
              open={pickerOpen}
              anchorEl={pickerAnchor}
              names={chartDataKey}
              delays={delayLabels}
              draft={draftCharts}
              query={taskQuery}
              onQuery={setTaskQuery}
              onToggle={toggleChart}
              onSelectResults={() => setDraftCharts(unionTaskNames(draftCharts, filterTasksByName(chartDataKey, taskQuery)))}
              onClear={() => setDraftCharts([])}
              onApply={applyDraft}
              onClose={closePicker}
            />
          </>
        ) : (
          <div className="flex min-h-[120px] items-center justify-center px-4 py-8">
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
          </div>
        )}
      </section>

      <Card data-testid="network-chart-card" className={cn("lite-panel overflow-hidden", { "bg-card/70": customBackgroundImage })}>
        <header className="lite-panel__heading">
          <div className="lite-chart-title">
            <h2>{t("monitor.allLatency")}</h2>
          </div>
          {showTaskLayout ? <HistoryTimePills hours={hours} onChange={onHoursChange} /> : null}
        </header>
        {showTaskLayout ? (
          <div className="lite-chart-context">
            <div className="lite-chart-legend">
              {visibleCharts.map((name) => (
                <span key={name} className="lite-chart-legend__item">
                  <i className="lite-task-dot" style={{ backgroundColor: getColorByIndex(name) }} />
                  <span>{name}</span>
                </span>
              ))}
            </div>
          </div>
        ) : null}
        {showTaskLayout ? (
          <CardContent className="lite-chart-body">
            <div className={cn("relative overflow-hidden", hasChartData ? "h-[275px] sm:h-[350px]" : "h-[188px] sm:h-[250px]")}>
              <ChartContainer
                aria-hidden={!hasChartData}
                config={chartConfig}
                data-testid="network-chart-canvas"
                className={cn(
                  "aspect-auto h-full w-full transition-opacity duration-150 motion-reduce:transition-none",
                  hasChartData ? "opacity-100" : "pointer-events-none absolute inset-0 opacity-0",
                )}
              >
                <ComposedChart data={hasChartData ? processedData : []} margin={{ left: phone ? 2 : 8, right: phone ? 6 : 12 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="created_at"
                    allowDuplicatedCategory={false}
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
                  <YAxis
                    yAxisId="delay"
                    width={phone ? 52 : 64}
                    domain={[0, "auto"]}
                    tickLine={false}
                    axisLine={false}
                    tickMargin={phone ? 4 : 8}
                    minTickGap={20}
                    tick={{ fontSize: phone ? 10 : 12 }}
                    tickFormatter={(value) => formatDelayAxisTick(Number(value), phone)}
                  />
                  {visibleCharts.length === 1 ? (
                    <YAxis yAxisId="packet-loss" width={phone ? 36 : 44} orientation="right" domain={[0, 100]} tickLine={false} axisLine={false} tickMargin={phone ? 4 : 8} minTickGap={20} tick={{ fontSize: phone ? 10 : 12 }} tickFormatter={(value) => `${value}%`} />
                  ) : null}
                  <ChartTooltip
                    isAnimationActive={false}
                    filterNull={false}
                    defaultIndex={undefined}
                    trigger="hover"
                    content={(tooltipProps) => {
                      // Axis label is the hovered time. Series payloads are matched by time, not by array index.
                      const time = Number(tooltipProps.label)
                      if (!tooltipProps.active || !Number.isFinite(time)) return null
                      const keys = visibleCharts.length > 0 ? visibleCharts : chartDataKey
                      const view = networkHoverView({
                        time,
                        bands: missingBands,
                        series: gapSeries,
                        values: keys.map((name) => ({
                          key: name,
                          value: (chartData[name] || []).find((point) => point.created_at === time)?.avg_delay ?? null,
                        })),
                        formatTime,
                      })
                      const packetLoss = keys.length === 1
                        ? (chartData[keys[0]] || []).find((point) => point.created_at === time)?.packet_loss
                        : null
                      return (
                        <div className="grid min-w-[8rem] gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
                          <span className="font-medium text-foreground">{view.label}</span>
                          {view.noRecord ? (
                            <div className="flex items-center gap-1.5 leading-none">
                              <i className="size-2 shrink-0 rounded-[2px] bg-[#919EAB]/40" />
                              <span className="text-foreground">{t("monitor.noRecord")}</span>
                            </div>
                          ) : null}
                          {view.lossKeys.length > 0 ? (
                            <span className="flex flex-wrap items-center gap-x-1 text-[12px] font-normal">
                              <span>{t("monitor.lossPrefix")}</span>
                              {view.lossKeys.map((name, index) => (
                                <span key={name} className="flex items-center gap-1">
                                  <i className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: getColorByIndex(name) }} />
                                  {name}
                                  {index < view.lossKeys.length - 1 ? t("monitor.listSeparator") : ""}
                                </span>
                              ))}
                            </span>
                          ) : null}
                          {view.values.map((item) => (
                            <div key={item.key} className="flex flex-1 items-center justify-between leading-none">
                              <span className="text-muted-foreground">{keys.length === 1 ? t("monitor.avgDelay") : item.key}</span>
                              <span className="ml-2 font-medium text-foreground tabular-nums">{item.value.toFixed(2)}ms</span>
                            </div>
                          ))}
                          {typeof packetLoss === "number" && Number.isFinite(packetLoss) && !view.noRecord ? (
                            <div className="flex flex-1 items-center justify-between leading-none">
                              <span className="text-muted-foreground">{t("monitor.packetLoss")}</span>
                              <span className="ml-2 font-medium text-foreground tabular-nums">{packetLoss.toFixed(2)}%</span>
                            </div>
                          ) : null}
                        </div>
                      )
                    }}
                  />
                  {hasChartData ? (
                    <Line
                      data={processedData}
                      dataKey={HOVER_ANCHOR_KEY}
                      yAxisId="marker"
                      stroke="none"
                      strokeWidth={0}
                      dot={false}
                      activeDot={false}
                      legendType="none"
                      isAnimationActive={false}
                      connectNulls={false}
                    />
                  ) : null}
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

      <section className="lite-panel lite-task-details">
        <header className="lite-panel__heading">
          <h2>{t("monitor.nodes")}</h2>
          <span className="lite-panel__subtle">
            {overviewMetrics.lastUpdated === null ? t("monitor.noStatus") : t("monitor.lastUpdateAt", { time: formatClockTime(overviewMetrics.lastUpdated) })}
          </span>
        </header>
        <div className="lite-task-table max-[620px]:hidden" role="table" aria-label={t("monitor.nodesTable")} style={{ overflow: "hidden" }}>
          <div className="lite-task-table__head" role="row">
            <span>{t("monitor.task")}</span>
            <span>{t("monitor.currentDelay")}</span>
            <span>{t("monitor.avgDelayFull")}</span>
            <span>{t("monitor.packetLoss")}</span>
            <span>{t("monitor.sampleCompleteness")}</span>
            <span>{t("monitor.lastUpdate")}</span>
          </div>
          {pagedSummaries.length > 0 ? pagedSummaries.map((summary) => (
            <div key={summary.name} className="lite-task-table__row" role="row">
              <span className="lite-task-name" title={summary.name}>
                <i className="lite-task-dot" style={{ backgroundColor: getColorByIndex(summary.name) }} />
                <span className="min-w-0 truncate">{summary.name}</span>
              </span>
              <span><SplitText value={summary.currentDelay} digits={2} unit="ms" /></span>
              <span><SplitText value={summary.averageDelay} digits={2} unit="ms" /></span>
              <span className={summary.packetLoss && summary.packetLoss > 0 ? "is-loss-alert" : undefined}><SplitText value={summary.packetLoss} digits={1} unit="%" /></span>
              <span><SplitText value={completenessPercent(completenessByTask[summary.name])} digits={0} unit="%" /></span>
              <span className="lite-task-table__updated">{summary.lastUpdated === null ? "--" : formatCompactTime(summary.lastUpdated)}</span>
            </div>
          )) : (
            <p className="lite-task-table__empty">{hasTasks ? t("monitor.noSamples") : t("monitor.noProbeData")}</p>
          )}
        </div>
        <div className="hidden max-[620px]:block">
          {pagedSummaries.length > 0 ? pagedSummaries.map((summary) => (
            <div key={summary.name} className="grid grid-cols-4 gap-x-2.5 gap-y-2.5 border-t border-[var(--lite-line)] px-[15px] py-3.5">
              <div className="col-span-3 min-w-0">
                <p className="lite-task-name truncate text-xs font-medium" title={summary.name}>
                  <i className="lite-task-dot" style={{ backgroundColor: getColorByIndex(summary.name) }} />
                  <span className="min-w-0 truncate">{summary.name}</span>
                </p>
              </div>
              <p className="text-right text-[9px] text-[#919EAB]">{summary.lastUpdated === null ? "--" : formatCompactTime(summary.lastUpdated)}</p>
              <div>
                <span className="mb-1 block text-[9px] text-[#919EAB]">{t("monitor.currentDelay")}</span>
                <b className="text-[17px] font-medium"><SplitText value={summary.currentDelay} digits={2} unit="ms" /></b>
              </div>
              <div>
                <span className="mb-1 block text-[9px] text-[#919EAB]">{t("monitor.avgDelayFull")}</span>
                <b className="text-[17px] font-medium"><SplitText value={summary.averageDelay} digits={2} unit="ms" /></b>
              </div>
              <div>
                <span className="mb-1 block text-[9px] text-[#919EAB]">{t("monitor.packetLoss")}</span>
                <b className="text-[17px] font-medium"><SplitText value={summary.packetLoss} digits={1} unit="%" /></b>
              </div>
              <div>
                <span className="mb-1 block text-[9px] text-[#919EAB]">{t("monitor.sampleCompleteness")}</span>
                <b className="text-[17px] font-medium"><SplitText value={completenessPercent(completenessByTask[summary.name])} digits={0} unit="%" /></b>
              </div>
            </div>
          )) : (
            <p className="px-4 py-8 text-center text-xs text-[#919EAB]">{hasTasks ? t("monitor.noSamples") : t("monitor.noProbeData")}</p>
          )}
        </div>
        {pages > 1 ? (
          <nav className="lite-pager" aria-label={t("monitor.nodesTable")}>
            <button type="button" disabled={safePage <= 1} onClick={() => setTablePage(safePage - 1)}>{t("monitor.prevPage")}</button>
            {pageItems.map((item, index) => item === "ellipsis" ? (
              <span key={`ellipsis-${index}`}>…</span>
            ) : (
              <button key={item} type="button" className={cn(item === safePage && "is-active")} onClick={() => setTablePage(item)}>{item}</button>
            ))}
            <button type="button" disabled={safePage >= pages} onClick={() => setTablePage(safePage + 1)}>{t("monitor.nextPage")}</button>
          </nav>
        ) : null}
        <div className="lite-route-summary">
          <div className="lite-route-summary__label">
            <h2>{t("monitor.routeSummary")}</h2>
            <span>{t("monitor.routeHint")}</span>
          </div>
          <div>
            <span>{t("monitor.bestTask")}</span>
            <strong title={overviewMetrics.bestTask?.name || undefined}>
              {overviewMetrics.bestTask ? <i className="lite-task-dot" style={{ backgroundColor: getColorByIndex(overviewMetrics.bestTask.name) }} /> : null}
              {overviewMetrics.bestTask?.name || "--"}
            </strong>
          </div>
          <div>
            <span>{t("monitor.availability")}</span>
            <SplitStrong value={overviewMetrics.bestTask?.availability ?? null} digits={2} unit="%" />
          </div>
          <div>
            <span>{t("monitor.sampleWindow")}</span>
            <strong>
              {t(sampleRange.key, { count: sampleRange.count })}
              <small>/ {overviewMetrics.bestTask?.samples || "--"}</small>
            </strong>
          </div>
          <div>
            <span>{t("monitor.routeStatus")}</span>
            <strong className={overviewMetrics.bestTask?.healthy ? "is-stable" : undefined}>
              <i className="lite-task-dot" style={{ background: overviewMetrics.bestTask?.healthy ? "var(--lite-online)" : "var(--lite-offline)" }} />
              {overviewMetrics.bestTask?.healthy ? t("monitor.stable") : t("monitor.noStatus")}
            </strong>
          </div>
        </div>
      </section>
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
