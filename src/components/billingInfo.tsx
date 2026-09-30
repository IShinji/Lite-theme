import { getBillingRemainingTone } from "@/lib/billing-status"
import { formatRemainingValue } from "@/lib/remaining-value"
import { readShowServerRemainingValue } from "@/lib/theme-config"
import { isLongTermExpiry } from "@/lib/theme-billing"
import { PublicNoteData, formatBillingAmount, getDaysBetweenDatesWithAutoRenewal } from "@/lib/utils"
import { LITE_BLUE, LITE_BLUE_SOFT, LITE_BLUE_SOFT_STRONG } from "@/theme/brand"
import { Chip } from "@mui/material"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

export default function BillingInfo({
  parsedData,
  remainingValue,
  remainingValueCurrency,
}: {
  parsedData: PublicNoteData
  remainingValue?: string
  remainingValueCurrency?: string
}) {
  const { t } = useTranslation()
  const [, setTick] = useState(0)
  const billingData = parsedData?.billingDataMod
  useEffect(() => {
    const id = window.setInterval(() => setTick((value) => value + 1), 30000)
    return () => window.clearInterval(id)
  }, [])
  if (!billingData) return null

  const hasPrice = Boolean(billingData.amount && billingData.amount !== "0" && billingData.amount !== "-1")
  const price = hasPrice
    ? `${formatBillingAmount(billingData.amount, billingData.currency)}/${billingData.cycle}`
    : billingData.amount === "-1"
      ? t("billingInfo.free")
      : "--"
  let indefinite = false
  let days = 0

  if (isLongTermExpiry(billingData.endDate)) {
    indefinite = true
  } else if (billingData.endDate) {
    try {
      days = getDaysBetweenDatesWithAutoRenewal(billingData).days
    } catch {
      return <span className="text-[11px] text-[#B71D18]">{t("billingInfo.error")}</span>
    }
  }

  const expired = !indefinite && days <= 0
  const remainingTone = getBillingRemainingTone(expired ? -1 : days, indefinite)
  const remainingLabel = expired ? t("billingInfo.expired") : t("billingInfo.remainingShort")
  const remainingDaysText = indefinite ? t("billingInfo.indefinite") : expired ? t("billingInfo.expired") : `${Math.abs(days)} ${t("billingInfo.days")}`
  const chipColor = remainingTone === "danger" || expired
    ? { bg: "rgba(255,86,48,0.10)", fg: "#B71D18", darkFg: "#F18C84" }
    : indefinite
      ? { bg: "#F4F6F8", fg: "#637381", darkFg: "#C4CDD5" }
      : { bg: "rgba(34,197,94,0.10)", fg: "#118D57", darkFg: "#61C8A5" }
  const remainingValueLabel = readShowServerRemainingValue()
    ? formatRemainingValue(remainingValue, remainingValueCurrency || billingData.currency)
    : ""

  return (
    <div className="billing inline-flex max-w-full flex-wrap items-center gap-1.5">
      <strong className="truncate whitespace-nowrap text-[11px] font-medium text-[#637381]">{price}</strong>
      <Chip
        size="small"
        label={indefinite || expired ? remainingDaysText : `${remainingLabel} ${remainingDaysText}`}
        sx={{
          height: 21,
          fontSize: 9,
          fontWeight: 500,
          borderRadius: "6px",
          bgcolor: chipColor.bg,
          color: chipColor.fg,
          ".dark &": { color: chipColor.darkFg, bgcolor: remainingTone === "danger" || expired ? "rgba(255,86,48,0.16)" : "#2A3A4D" },
          "& .MuiChip-label": { px: 0.75 },
        }}
      />
      {remainingValueLabel ? (
        <Chip
          size="small"
          data-testid="remaining-value"
          label={`${t("billingInfo.remainingShort")} ${remainingValueLabel}`}
          sx={{
            height: 21,
            fontSize: 9,
            fontWeight: 500,
            borderRadius: "6px",
            bgcolor: LITE_BLUE_SOFT,
            color: LITE_BLUE,
            ".dark &": { bgcolor: LITE_BLUE_SOFT_STRONG, color: LITE_BLUE },
            "& .MuiChip-label": { px: 0.75 },
          }}
        />
      ) : null}
    </div>
  )
}
