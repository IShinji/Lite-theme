import { formatBytes } from "@/lib/format"
import { resourceUsageTone } from "@/lib/meter-tone"
import { daysUntilTrafficReset } from "@/lib/trafficReset"
import { cn } from "@/lib/utils"
import { useTranslation } from "react-i18next"

interface TrafficBarProps {
  used: number
  limit: number
  resetDay?: number
  resetAt?: string
  limitType: string
}

function trafficToneClass(percent: number) {
  const tone = resourceUsageTone(percent)
  if (tone === "amber") return "lite-server-card__tone--amber"
  if (tone === "coral") return "lite-server-card__tone--danger"
  return "lite-server-card__tone--traffic"
}

function resetToneClass(days: number | undefined) {
  if (days === undefined) return ""
  if (days <= 0) return "lite-server-card__tone--danger"
  if (days < 14) return "lite-server-card__tone--amber"
  return ""
}

function trafficFillClass(percent: number) {
  const tone = resourceUsageTone(percent)
  if (tone === "amber") return "lite-server-card__fill--amber"
  if (tone === "coral") return "lite-server-card__fill--danger"
  return "lite-server-card__fill--traffic"
}

export default function TrafficBar({ used, limit, resetDay, resetAt }: TrafficBarProps) {
  const { t } = useTranslation()
  if (limit <= 0) return null

  const percent = Math.min(100, Math.max(0, (used / limit) * 100))
  const resetInDays = daysUntilTrafficReset(resetDay, new Date(), resetAt)
  const resetLabel = resetInDays === undefined
    ? ""
    : resetInDays === 0
      ? t("traffic.resetToday")
      : t("traffic.resetInDays", { count: resetInDays })

  return (
    <div className="lite-server-card__quota">
      <div className="lite-server-card__quota-line">
        <b className="tabular-nums">{formatBytes(used)}</b>
        <span>/ {formatBytes(limit)}</span>
        <span className={cn("lite-server-card__quota-percent tabular-nums", trafficToneClass(percent))}>{percent.toFixed(2)}%</span>
      </div>
      <div className="lite-server-card__quota-meter" aria-hidden="true">
        <span className={trafficFillClass(percent)} style={{ width: `${percent}%` }} />
      </div>
      <div className="lite-server-card__quota-meta">
        <span>{t("traffic.usedTraffic")}</span>
        {resetLabel ? <span className={resetToneClass(resetInDays)}>{resetLabel}</span> : null}
      </div>
    </div>
  )
}
