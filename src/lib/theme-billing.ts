import dayjs from "dayjs"

export const THEME_LONG_TERM_END_DATE = "0000-00-00T23:59:59+08:00"

export function isLongTermExpiry(value?: string | number | Date | null): boolean {
  if (value === null || value === undefined || value === "") return true
  if (typeof value === "string" && value.startsWith("0000-00-00")) return true
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return true
  const year = date.getUTCFullYear()
  return year < 2 || year > 2200
}

export function remainingExpiryDaysCeil(endDate: string, nowMs = Date.now()): number | null {
  if (isLongTermExpiry(endDate)) return null
  const end = new Date(endDate).getTime()
  if (!Number.isFinite(end)) return null
  const remaining = end - nowMs
  if (remaining <= 0) return 0
  return Math.ceil(remaining / (24 * 60 * 60 * 1000) - 1e-12)
}

export function resolveThemeBillingEndDate(
  serverExpiredAt?: string | null,
  existingEndDate?: string | null,
): string | null {
  const serverRaw = typeof serverExpiredAt === "string" ? serverExpiredAt.trim() : ""
  if (serverRaw) {
    return isLongTermExpiry(serverRaw) ? THEME_LONG_TERM_END_DATE : serverRaw
  }
  const existing = typeof existingEndDate === "string" ? existingEndDate.trim() : ""
  return existing || null
}

export function resolveThemeBillingStartDate(
  server?: { expired_at?: string; billing_cycle?: number; created_at?: string } | null,
  existingStartDate?: string | null,
): string | null {
  if (existingStartDate) return existingStartDate
  const expiredRaw = server?.expired_at || ""
  const bc = Number(server?.billing_cycle || 0)
  if (!expiredRaw || !bc) return null
  const start = dayjs(expiredRaw).subtract(bc, "day")
  if (!start.isValid() || start.year() < 2) return null
  return start.toISOString()
}

export type ThemeBillingDataMod = {
  startDate?: string | null
  endDate: string
  autoRenewal: string
  cycle: string
  amount: string
  currency: string
}

export function mergeThemeBillingDataMod(
  existing:
    | {
        startDate?: string
        endDate?: string
        autoRenewal?: string
        cycle?: string
        amount?: string
        currency?: string
      }
    | null
    | undefined,
  server: {
    expiredAt?: string | null
    startDate?: string | null
    autoRenewal: string
    cycle: string
    amount: string
    currency: string
  },
): ThemeBillingDataMod | null {
  const endDate = resolveThemeBillingEndDate(server.expiredAt, existing?.endDate)
  if (!endDate) return null
  return {
    startDate: existing?.startDate || server.startDate,
    endDate,
    autoRenewal: existing?.autoRenewal || server.autoRenewal || "",
    cycle: existing?.cycle || (server.cycle === "-1" ? "" : server.cycle),
    amount: existing?.amount || server.amount,
    currency: server.currency || existing?.currency || "",
  }
}
