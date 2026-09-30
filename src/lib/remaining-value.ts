import { detectCanadianDollarCurrency, detectHongKongDollarCurrency, getStaticCurrencyLabel } from "./currency-label.ts"

export function formatRemainingValue(amount?: string | null, currency?: string): string {
  const rawAmount = String(amount ?? "").trim()
  if (!rawAmount) return ""

  const numeric = Number(rawAmount.replace(/,/g, ""))
  if (!Number.isFinite(numeric)) return ""

  const code = String(currency || "").trim().toUpperCase()
  const label =
    getStaticCurrencyLabel(code) ||
    (code === "CAD" || detectCanadianDollarCurrency(rawAmount) ? "C$" : undefined) ||
    (code === "HKD" || detectHongKongDollarCurrency(rawAmount) ? "HK$" : undefined) ||
    (code ? `${code} ` : "")
  const sign = numeric < 0 ? "-" : ""
  return `${sign}${label}${Math.abs(numeric).toFixed(2)}`
}
