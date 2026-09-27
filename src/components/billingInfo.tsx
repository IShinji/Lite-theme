import { getBillingRemainingTone } from "@/lib/billing-status"
import { PublicNoteData, formatBillingAmount, getDaysBetweenDatesWithAutoRenewal } from "@/lib/utils"
import { Chip } from "@mui/material"
import { useTranslation } from "react-i18next"

export default function BillingInfo({ parsedData }: { parsedData: PublicNoteData }) {
  const { t } = useTranslation()
  const billingData = parsedData?.billingDataMod
  if (!billingData) return null

  const hasPrice = Boolean(billingData.amount && billingData.amount !== "0" && billingData.amount !== "-1")
  const price = hasPrice
    ? `${formatBillingAmount(billingData.amount, billingData.currency)}/${billingData.cycle}`
    : billingData.amount === "-1"
      ? t("billingInfo.free")
      : "--"
  let indefinite = false
  let days = 0

  if (billingData.endDate?.startsWith("0000-00-00")) {
    indefinite = true
  } else if (billingData.endDate) {
    try {
      days = getDaysBetweenDatesWithAutoRenewal(billingData).days
    } catch {
      return <span className="text-[11px] text-[#B71D18]">{t("billingInfo.error")}</span>
    }
  }

  const remainingTone = getBillingRemainingTone(days, indefinite)
  const remainingLabel = days < 0 ? t("billingInfo.expired") : t("billingInfo.remainingShort")
  const remainingValue = indefinite ? t("billingInfo.indefinite") : `${Math.abs(days)} ${t("billingInfo.days")}`
  const chipColor = remainingTone === "danger" || days < 0
    ? { bg: "rgba(255,86,48,0.10)", fg: "#B71D18", darkFg: "#F18C84" }
    : indefinite
      ? { bg: "#F4F6F8", fg: "#637381", darkFg: "#C4CDD5" }
      : { bg: "rgba(34,197,94,0.10)", fg: "#118D57", darkFg: "#61C8A5" }

  return (
    <div className="billing inline-flex max-w-full flex-wrap items-center gap-1.5">
      <strong className="truncate whitespace-nowrap text-[11px] font-medium text-[#637381]">{price}</strong>
      <Chip
        size="small"
        label={indefinite || days < 0 ? remainingValue : `${remainingLabel} ${remainingValue}`}
        sx={{
          height: 21,
          fontSize: 9,
          fontWeight: 500,
          borderRadius: "6px",
          bgcolor: chipColor.bg,
          color: chipColor.fg,
          ".dark &": { color: chipColor.darkFg, bgcolor: remainingTone === "danger" || days < 0 ? "rgba(255,86,48,0.16)" : "#2A3A4D" },
          "& .MuiChip-label": { px: 0.75 },
        }}
      />
    </div>
  )
}
