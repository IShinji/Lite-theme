import { trafficHoverAlign, trafficHoverLeftPercent } from "@/lib/traffic-hover"
import { cn } from "@/lib/utils"
import { useTranslation } from "react-i18next"

export function TrafficHoverDots({
  up,
  down,
  width,
  height,
}: {
  up: { x: number; y: number }
  down: { x: number; y: number }
  width: number
  height: number
}) {
  return (
    <>
      <i className="lite-traffic-dot is-up" style={{ left: `${(up.x / width) * 100}%`, top: `${(up.y / height) * 100}%` }} />
      <i className="lite-traffic-dot is-down" style={{ left: `${(down.x / width) * 100}%`, top: `${(down.y / height) * 100}%` }} />
    </>
  )
}

export default function TrafficSpeedTooltip({
  time,
  up,
  down,
  index,
  count,
}: {
  time: string
  up: string
  down: string
  index: number
  count: number
}) {
  const { t } = useTranslation()
  const align = trafficHoverAlign(index, count)
  return (
    <div
      className={cn("lite-traffic-tip", `is-${align}`)}
      role="tooltip"
      style={align === "center" ? { left: `${trafficHoverLeftPercent(index, count)}%` } : undefined}
    >
      <time>{time}</time>
      <p>
        <i className="is-up" />
        {t("serverOverview.uploadShort")}
        <b>{up}</b>
      </p>
      <p>
        <i className="is-down" />
        {t("serverOverview.downloadShort")}
        <b>{down}</b>
      </p>
    </div>
  )
}
