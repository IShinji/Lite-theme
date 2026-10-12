export const HISTORY_TIME_OPTIONS = [
  { value: 1, label: "1h" },
  { value: 6, label: "6h" },
  { value: 12, label: "12h" },
  { value: 24, label: "24h" },
  { value: 72, label: "3d" },
  { value: 168, label: "7d" },
  { value: 720, label: "30d" },
] as const

export type HistoryHours = (typeof HISTORY_TIME_OPTIONS)[number]["value"]

export function historyRangeI18n(hours: number): { key: "monitor.hoursCount" | "monitor.daysCount"; count: number } {
  if (hours >= 48 && hours % 24 === 0) return { key: "monitor.daysCount", count: hours / 24 }
  return { key: "monitor.hoursCount", count: hours }
}

export function parseHistoryHours(value: unknown, fallback: HistoryHours = 1): HistoryHours {
  const raw = String(value ?? "").trim()
  const match = HISTORY_TIME_OPTIONS.find((option) => option.label === raw || String(option.value) === raw)
  return match?.value ?? fallback
}

export function historyMaxPoints(hours: number): number {
  if (hours <= 1) return 90
  if (hours <= 24) return 180
  if (hours <= 168) return 240
  return 300
}

export function probeHistoryMaxPoints(hours: number): number {
  if (hours <= 1) return 720
  return historyMaxPoints(hours)
}

export function historyRefetchMs(hours: number): number {
  if (hours <= 24) return 30_000
  if (hours <= 168) return 120_000
  return 300_000
}
