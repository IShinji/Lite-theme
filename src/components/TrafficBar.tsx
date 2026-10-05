import { formatBytes } from "@/lib/format"
import { METER_TONE_COLOR, resourceUsageTone } from "@/lib/meter-tone"
import { daysUntilTrafficReset } from "@/lib/trafficReset"
import { useTranslation } from "react-i18next"

interface TrafficBarProps {
  used: number
  limit: number
  resetDay?: number
  limitType: string
}

export default function TrafficBar({ used, limit, resetDay }: TrafficBarProps) {
  const { t } = useTranslation()
  if (limit <= 0) return null

  const percent = Math.min(100, Math.max(0, (used / limit) * 100))
  const tone = METER_TONE_COLOR[resourceUsageTone(percent)]
  const resetInDays = daysUntilTrafficReset(resetDay)
  const resetLabel = resetInDays === undefined
    ? ""
    : resetInDays === 0
      ? t("traffic.resetToday")
      : t("traffic.resetInDays", { count: resetInDays })

  return (
    <div className="mx-[18px] border-t border-[var(--lite-line)] py-2.5 max-[967px]:mx-[15px]">
      <div className="flex justify-between gap-4 text-[11px] text-[#919EAB]">
        <span>
          <strong className="text-[13px] font-medium text-[#637381]">{formatBytes(used)}</strong> / {formatBytes(limit)}
        </span>
        <span className="text-right max-[967px]:text-left">
          {percent.toFixed(2)}%{resetLabel ? ` · ${resetLabel}` : ""}
        </span>
      </div>
      <div className="mt-1.5 h-[5px] overflow-hidden rounded-[3px] bg-[#F4F6F8] dark:bg-[#2A3A4D]">
        <span className="block h-full rounded-[3px] transition-[width] duration-300" style={{ width: `${percent}%`, background: tone }} />
      </div>
    </div>
  )
}
