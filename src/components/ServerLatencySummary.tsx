import {
  HOME_LATENCY_CARD_LIMIT,
  type HomeLatencyTaskSummary,
  formatProbeLatency,
  formatProbePacketLoss,
  hourPacketFillPercent,
  latencyBarTone,
} from "@/lib/home-latency"
import { probeAccentIndex } from "@/lib/home-probe-accent"
import { returnLineForPingTask, type PublicReturnRoute } from "@/lib/home-return-route"
import { readShowHomePacketLoss, readShowHomeReturnRoute } from "@/lib/theme-config"
import { useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"

function TaskProbe({
  summary,
  returnLine,
  accentIds,
  showPacketLoss,
  keepReturnRow,
  onSelect,
  onPress,
}: {
  summary: HomeLatencyTaskSummary
  returnLine: string
  accentIds: readonly string[]
  showPacketLoss: boolean
  keepReturnRow: boolean
  onSelect?: (taskId: string) => void
  onPress?: () => void
}) {
  const { t } = useTranslation()
  const latency = formatProbeLatency(summary.latency)
  const delayTone = latencyBarTone(summary.latency)
  const packetLoss = formatProbePacketLoss(summary.packetLoss)
  const percent = hourPacketFillPercent(summary)
  const lossLabel = t("serverCard.packetLoss")
  const latencyLabel = latency.unit ? `${latency.value} ${latency.unit}` : latency.value
  const title = [
    summary.taskName,
    returnLine,
    latencyLabel,
    showPacketLoss ? `${lossLabel} ${packetLoss}` : "",
    t("serverCard.sampleFill", { percent: percent.toFixed(0) }),
  ]
    .filter(Boolean)
    .join(" · ")

  return (
    <button
      type="button"
      title={title}
      data-accent={probeAccentIndex(summary.taskId, accentIds)}
      data-return={returnLine ? "true" : "false"}
      data-loss={showPacketLoss ? "true" : "false"}
      onPointerDown={() => onPress?.()}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return
        event.stopPropagation()
        if (event.key === " ") event.preventDefault()
      }}
      onClick={(event) => {
        if (!onSelect) return
        event.stopPropagation()
        onSelect(summary.taskId)
      }}
      className="lite-probe-chip"
    >
      <span className="lite-probe-chip__name" title={summary.taskName}>{summary.taskName}</span>
      {returnLine ? (
        <span className="lite-probe-chip__tag">{returnLine}</span>
      ) : keepReturnRow ? (
        <span className="lite-probe-chip__slot" aria-hidden="true" />
      ) : null}
      <span className="lite-probe-chip__delay">
        <span className="lite-probe-chip__delay-value tabular-nums" data-tone={delayTone}>
          <b>{latency.value}</b>
          {latency.unit ? <small>{latency.unit}</small> : null}
        </span>
      </span>
      {showPacketLoss ? (
        <span className="lite-probe-chip__loss">
          <span>{lossLabel}</span>
          <b className="tabular-nums">{packetLoss}</b>
        </span>
      ) : null}
    </button>
  )
}

export default function ServerLatencySummary({
  summaries,
  returnRoute,
  onSelectTask,
  onPrefetch,
}: {
  summaries?: HomeLatencyTaskSummary[]
  returnRoute?: PublicReturnRoute
  onSelectTask?: (taskId: string) => void
  onPrefetch?: (priority: boolean) => void
}) {
  const { t } = useTranslation()
  const showReturnRoute = readShowHomeReturnRoute()
  const showPacketLoss = readShowHomePacketLoss()
  const displayed = (summaries || []).slice(0, HOME_LATENCY_CARD_LIMIT)
  const accentIds = displayed.map((item) => item.taskId)
  const returnLines = displayed.map((item) => (showReturnRoute ? returnLineForPingTask(returnRoute, item.taskId) : ""))
  const hasAnyReturn = returnLines.some(Boolean)
  const sectionRef = useRef<HTMLElement>(null)
  const prefetchRef = useRef(onPrefetch)
  prefetchRef.current = onPrefetch

  useEffect(() => {
    const node = sectionRef.current
    if (!node) return

    let dwell: number | undefined
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && entry.intersectionRatio >= 0.5) {
          dwell = window.setTimeout(() => prefetchRef.current?.(false), 300)
          return
        }
        if (dwell !== undefined) {
          window.clearTimeout(dwell)
          dwell = undefined
        }
      },
      { threshold: [0.5] },
    )
    observer.observe(node)
    return () => {
      observer.disconnect()
      if (dwell !== undefined) window.clearTimeout(dwell)
    }
  }, [])

  return (
    <section
      ref={sectionRef}
      onPointerEnter={() => onPrefetch?.(true)}
      className="lite-server-card__quality"
      data-testid="server-latency-summary"
    >
      <div className="lite-server-card__quality-title">
        <h3>{t("serverCard.networkQuality")}</h3>
        <span>{t("serverCard.recentHour")}</span>
      </div>
      {displayed.length > 0 ? (
        <div
          className="lite-server-card__probes"
          data-count={displayed.length}
          data-loss={showPacketLoss ? "true" : "false"}
          data-return={hasAnyReturn ? "true" : "false"}
        >
          {displayed.map((item, index) => (
            <TaskProbe
              key={item.taskId}
              summary={item}
              returnLine={returnLines[index] || ""}
              accentIds={accentIds}
              showPacketLoss={showPacketLoss}
              keepReturnRow={hasAnyReturn && displayed.length < 4}
              onSelect={onSelectTask}
              onPress={() => onPrefetch?.(true)}
            />
          ))}
        </div>
      ) : (
        <div className="grid place-items-center py-3 text-center text-[11px] leading-snug text-[var(--card-muted)]">
          {t("monitor.noData")}
        </div>
      )}
    </section>
  )
}
