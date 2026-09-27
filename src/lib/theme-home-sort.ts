import { SORT_ORDERS, SORT_TYPES, type SortOrder, type SortType } from "@/context/sort-context"
import { formatLiteInfo } from "@/lib/utils"
import type { LiteServer } from "@/types/lite-api"

function readWindowSetting(key: string): unknown {
  if (typeof window === "undefined") return undefined
  return (window as unknown as Record<string, unknown>)[key]
}

export function readThemeHomeSort(): { sortType: SortType; sortOrder: SortOrder } {
  const rawType = String(readWindowSetting("HomeSortType") || "").trim()
  const rawOrder = String(readWindowSetting("HomeSortOrder") || "").trim().toLowerCase()
  const sortType = SORT_TYPES.includes(rawType as SortType) ? (rawType as SortType) : "default"
  const sortOrder = SORT_ORDERS.includes(rawOrder as SortOrder) ? (rawOrder as SortOrder) : "desc"
  return { sortType, sortOrder }
}

export function compareHomeServers(a: LiteServer, b: LiteServer, now: number, sortType: SortType, sortOrder: SortOrder): number {
  const aInfo = formatLiteInfo(now, a)
  const bInfo = formatLiteInfo(now, b)
  if (sortType !== "name" && aInfo.online !== bInfo.online) return aInfo.online ? -1 : 1

  let comparison = 0
  switch (sortType) {
    case "name":
      comparison = a.name.localeCompare(b.name)
      break
    case "uptime":
      comparison = (a.state?.uptime || 0) - (b.state?.uptime || 0)
      break
    case "system":
      comparison = a.host.platform.localeCompare(b.host.platform)
      break
    case "cpu":
      comparison = (a.state?.cpu || 0) - (b.state?.cpu || 0)
      break
    case "mem":
      comparison = aInfo.mem - bInfo.mem
      break
    case "disk":
      comparison = aInfo.disk - bInfo.disk
      break
    case "up":
      comparison = (a.state?.net_out_speed || 0) - (b.state?.net_out_speed || 0)
      break
    case "down":
      comparison = (a.state?.net_in_speed || 0) - (b.state?.net_in_speed || 0)
      break
    default:
      comparison = (a.display_index || 0) - (b.display_index || 0)
  }
  return sortOrder === "asc" ? comparison : -comparison
}
