import { parseHistoryHours, type HistoryHours } from "./history-range.ts"

function readWindowSetting(key: string): unknown {
  if (typeof window === "undefined") return undefined
  return (window as unknown as Record<string, unknown>)[key]
}

export function readThemeBoolean(key: string, fallback = false): boolean {
  const value = readWindowSetting(key)
  if (value === true || value === 1 || value === "1" || value === "true") return true
  if (value === false || value === 0 || value === "0" || value === "false") return false
  return fallback
}

export function readShowServerBandwidth(): boolean {
  return readThemeBoolean("ShowServerBandwidth", false)
}

export function readShowHomePacketLoss(): boolean {
  return readThemeBoolean("ShowHomePacketLoss", false)
}

export function readShowServerRemainingValue(): boolean {
  return readThemeBoolean("ShowServerRemainingValue", true)
}

export function serverBandwidthLabel(value: unknown): string {
  return String(value || "").trim()
}

export function readDefaultProbeChartHours(): HistoryHours {
  return parseHistoryHours(readWindowSetting("DefaultProbeChartHours"))
}
