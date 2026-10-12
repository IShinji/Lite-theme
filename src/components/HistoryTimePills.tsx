import { HISTORY_TIME_OPTIONS, historyRangeI18n } from "@/lib/history-range"
import { cn } from "@/lib/utils"
import { Menu, MenuItem, useMediaQuery } from "@mui/material"
import { ChevronDown } from "lucide-react"
import { useState, type MouseEvent } from "react"
import { useTranslation } from "react-i18next"

const DESKTOP_PRIMARY_HOURS = [1, 6, 24] as const
const PHONE_PRIMARY_HOURS = [1, 6] as const

function hoursLabel(hours: number, t: (key: string, options?: Record<string, unknown>) => string) {
  const range = historyRangeI18n(hours)
  return t(range.key, { count: range.count })
}

export default function HistoryTimePills({ hours, onChange }: { hours: number; onChange: (hours: number) => void }) {
  const { t } = useTranslation()
  const phone = useMediaQuery("(max-width: 967px)")
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const primaryHours = phone ? PHONE_PRIMARY_HOURS : DESKTOP_PRIMARY_HOURS
  const moreOptions = HISTORY_TIME_OPTIONS.filter((option) => !(primaryHours as readonly number[]).includes(option.value))
  const extra = moreOptions.find((option) => option.value === hours)

  return (
    <div className="lite-time-pills" role="group" aria-label={t("monitor.timeRange")}>
      {primaryHours.map((value) => {
        const option = HISTORY_TIME_OPTIONS.find((item) => item.value === value)
        if (!option) return null
        return (
          <button
            key={value}
            type="button"
            className={cn(hours === value && "is-active")}
            onClick={() => onChange(value)}
          >
            {hoursLabel(value, t)}
          </button>
        )
      })}
      <button
        type="button"
        className={cn("lite-time-pills__more", extra && "is-active")}
        aria-haspopup="menu"
        aria-expanded={Boolean(anchor)}
        onClick={(event: MouseEvent<HTMLButtonElement>) => setAnchor(event.currentTarget)}
      >
        {extra ? hoursLabel(extra.value, t) : t("common.more")}
        <ChevronDown className="size-3" />
      </button>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        disableScrollLock
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        {moreOptions.map((option) => (
          <MenuItem
            key={option.value}
            selected={option.value === hours}
            onClick={() => {
              onChange(option.value)
              setAnchor(null)
            }}
          >
            {hoursLabel(option.value, t)}
          </MenuItem>
        ))}
      </Menu>
    </div>
  )
}
