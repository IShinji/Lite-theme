export type SortType = "default" | "name" | "uptime" | "system" | "cpu" | "mem" | "disk" | "up" | "down" | "expiry"

export const SORT_TYPES: SortType[] = ["default", "name", "uptime", "system", "cpu", "mem", "disk", "up", "down", "expiry"]

export type SortOrder = "asc" | "desc"

export const SORT_ORDERS: SortOrder[] = ["desc", "asc"]
