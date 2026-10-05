import {
  HOME_LATENCY_CARD_LIMIT,
  type HomeLatencyTaskSummary,
  formatProbePacketLoss,
  hourPacketFillPercent,
  latencyBarTone,
} from "@/lib/home-latency"
import { METER_TONE_COLOR, packetFillTone } from "@/lib/meter-tone"
import { readShowHomePacketLoss } from "@/lib/theme-config"
import { THEME } from "@/lib/theme-tokens"
import { cn } from "@/lib/utils"
import { useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"

function TaskProbe({
  summary,
  showPacketLoss,
  onSelect,
  onPress,
}: {
  summary: HomeLatencyTaskSummary
  showPacketLoss: boolean
  onSelect?: (taskId: string) => void
  onPress?: () => void
}) {
  const { t } = useTranslation()
  const latencyTone = latencyBarTone(summary.latency)
  const latency = summary.latency === null ? "--" : `${Math.round(summary.latency)} ms`
  const packetLoss = formatProbePacketLoss(summary.packetLoss)
  const percent = hourPacketFillPercent(summary)
  const fillTone = packetFillTone(percent)
  const lossLabel = t("serverCard.packetLoss")
  const title = showPacketLoss ? `${summary.taskName} · ${latency} · ${lossLabel} ${packetLoss}` : `${summary.taskName} · ${latency}`

  return (
    <button
      type="button"
      title={title}
      onPointerDown={() => onPress?.()}
      onClick={(event) => {
        if (!onSelect) return
        event.stopPropagation()
        onSelect(summary.taskId)
      }}
      className="probe min-w-0 text-left"
    >
      <div className="flex min-w-0 items-center justify-between gap-2 overflow-hidden">
        <span className="min-w-[4em] flex-1 truncate text-[11px] font-medium leading-none text-[#566571] dark:text-[#B2C0C9]">{summary.taskName}</span>
        <span className="flex shrink-0 items-center gap-2 max-[967px]:gap-1.5">
          <strong className="text-[16px] font-semibold leading-none tabular-nums max-[967px]:text-[15px]" style={{ color: METER_TONE_COLOR[latencyTone] }}>
            {latency}
          </strong>
          {showPacketLoss ? (
            <>
              <span aria-hidden="true" className="h-2.5 w-px bg-[#DCE3E7] dark:bg-[#35434D]" />
              <span className="whitespace-nowrap text-[11px] leading-none tabular-nums text-[#7A8792]">{packetLoss}</span>
            </>
          ) : null}
        </span>
      </div>
      <div className="mt-1.5 h-[5px] overflow-hidden rounded-[3px] bg-[#E9EEF1] dark:bg-[#2B3740]">
        <span
          className="block h-full rounded-[3px]"
          style={{ width: `${percent}%`, background: fillTone === "empty" ? "transparent" : METER_TONE_COLOR[fillTone] }}
        />
      </div>
    </button>
  )
}

export default function ServerLatencySummary({
  summaries,
  stackProbes,
  onSelectTask,
  onPrefetch,
}: {
  summaries?: HomeLatencyTaskSummary[]
  stackProbes?: boolean
  onSelectTask?: (taskId: string) => void
  onPrefetch?: (priority: boolean) => void
}) {
  const { t } = useTranslation()
  const showPacketLoss = readShowHomePacketLoss()
  const displayed = (summaries || []).slice(0, HOME_LATENCY_CARD_LIMIT)
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
      className="mx-[18px] border-t border-[var(--lite-line)] pb-2 pt-3 max-[967px]:mx-[15px]"
      data-testid="server-latency-summary"
    >
      <div className="flex items-center justify-between gap-4">
        <span className="flex items-center gap-[9px] text-xs font-semibold text-[#566571] dark:text-[#B2C0C9]">
          <svg
            className="h-2.5 w-[18px]"
            viewBox="0 0 20 10"
            aria-hidden="true"
            fill="none"
            stroke={THEME.green}
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M1 6h3l2-4 3 7 3-6 2 3h5" />
          </svg>
          {t("serverCard.networkQuality")}
        </span>
        <span className="text-[10px] text-[#7A8792]">{t("serverCard.recentHour")}</span>
      </div>
      {displayed.length > 0 ? (
        <div
          data-probe-layout={stackProbes ? "stack" : "grid"}
          className={cn(
            "mt-1.5 grid gap-x-5 gap-y-2 max-[967px]:gap-x-3 min-[1440px]:gap-x-3",
            stackProbes ? "grid-cols-1" : "grid-cols-2 [&>.probe:nth-child(odd):last-child]:col-span-2",
          )}
        >
          {displayed.map((item) => (
            <TaskProbe key={item.taskId} summary={item} showPacketLoss={showPacketLoss} onSelect={onSelectTask} onPress={() => onPrefetch?.(true)} />
          ))}
        </div>
      ) : (
        <div className="grid min-h-[48px] place-items-center text-center text-[11px] leading-snug text-[#7A8792]">
          {t("monitor.noData")}
        </div>
      )}
    </section>
  )
}
