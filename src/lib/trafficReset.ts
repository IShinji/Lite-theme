const DAY_MS = 24 * 60 * 60 * 1000

function actualResetDate(year: number, month: number, resetDay: number): Date {
  const lastDay = new Date(year, month + 1, 0).getDate()
  if (resetDay <= lastDay) return new Date(year, month, resetDay)
  return new Date(year, month + 1, 1)
}

function sameCalendarDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate()
}

function calendarDayDistance(from: Date, to: Date): number {
  const fromUTC = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())
  const toUTC = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate())
  return Math.max(0, Math.round((toUTC - fromUTC) / DAY_MS))
}

// 后端下发的 traffic_reset_at 是带时区的下次重置时刻（RFC3339）。
// 后端给主题的 traffic_reset_day 是折成默认时区后的日历日，跟浏览器本地日期相减会差一天以上，所以优先用精确时刻，口径与「剩余 N 天」一致（向上取整）。
function daysUntilResetAt(resetAt: string | undefined, now: Date): number | undefined {
  if (!resetAt) return undefined
  const target = Date.parse(resetAt)
  if (!Number.isFinite(target)) return undefined
  const diff = target - now.getTime()
  if (diff <= 0) return undefined // 已过期（页面缓存旧数据），退回按日期算
  return Math.ceil(diff / DAY_MS - 1e-12)
}

export function daysUntilTrafficReset(resetDay?: number, now = new Date(), resetAt?: string): number | undefined {
  const exact = daysUntilResetAt(resetAt, now)
  if (exact !== undefined) return exact
  if (!Number.isInteger(resetDay) || !resetDay || resetDay < 1 || resetDay > 31) return undefined

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const thisMonth = actualResetDate(today.getFullYear(), today.getMonth(), resetDay)
  const previousMonth = actualResetDate(today.getFullYear(), today.getMonth() - 1, resetDay)

  if (sameCalendarDay(today, thisMonth) || sameCalendarDay(today, previousMonth)) return 0
  if (today < thisMonth) return calendarDayDistance(today, thisMonth)

  const nextMonth = actualResetDate(today.getFullYear(), today.getMonth() + 1, resetDay)
  return calendarDayDistance(today, nextMonth)
}
