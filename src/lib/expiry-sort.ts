import { isLongTermExpiry } from "./theme-billing.ts"

/** 到期时间的毫秒时间戳；没有到期日、长期有效（theme-billing 的 isLongTermExpiry）或解析不了都返回 null。 */
export function expiryTimestamp(raw?: string | null): number | null {
  if (typeof raw !== "string" || !raw.trim()) return null
  if (isLongTermExpiry(raw)) return null
  const t = new Date(raw).getTime()
  return Number.isFinite(t) ? t : null
}

type ExpirySortable = { expired_at?: string | null; display_index?: number }

/**
 * 「到期时间」排序：最先到期的排最前（已经过期的最靠前，它最紧急）；没有到期日 / 长期有效的排最后；
 * 时间相同或都没有到期日时按主题默认顺序（display_index）。与升降序设置无关——「按到期时间排」想要的就是快到期的在前。
 */
export function compareByExpiry(a: ExpirySortable, b: ExpirySortable): number {
  const ka = expiryTimestamp(a.expired_at)
  const kb = expiryTimestamp(b.expired_at)
  if (ka !== null && kb !== null && ka !== kb) return ka - kb
  if (ka === null && kb !== null) return 1
  if (ka !== null && kb === null) return -1
  return (a.display_index || 0) - (b.display_index || 0)
}
