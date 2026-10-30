import { parseHistoryHours, type HistoryHours } from "./history-range.ts"
import { parseHomeProbeTaskOverrides } from "./home-probe-tasks.ts"

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

export function readShowMobileHomeOverview(): boolean {
  return readThemeBoolean("ShowMobileHomeOverview", false)
}

export function readShowHomeGlobe(): boolean {
  return readThemeBoolean("ShowHomeGlobe", false)
}

export function readGlobeLinks(): unknown {
  return readWindowSetting("GlobeLinks")
}

export function readGlobeTopologyUrl(): string {
  const value = readWindowSetting("GlobeTopologyUrl")
  return typeof value === "string" ? value.trim() : ""
}

const DEFAULT_HELPER_URL = "http://127.0.0.1:5174"

/** 助手地址只允许 http://127.0.0.1:端口、http://localhost:端口 或 https://；其他一律回退默认。 */
export function normalizeHelperUrl(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : ""
  if (!text) return DEFAULT_HELPER_URL
  try {
    const u = new URL(text)
    const local = u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost") && u.port !== ""
    if (!local && u.protocol !== "https:") return DEFAULT_HELPER_URL
    if (u.username || u.password) return DEFAULT_HELPER_URL
    return u.origin + (u.pathname === "/" ? "" : u.pathname.replace(/\/$/, ""))
  } catch {
    return DEFAULT_HELPER_URL
  }
}

export function readGlobeHelperUrl(): string {
  return normalizeHelperUrl(readWindowSetting("GlobeHelperUrl"))
}

export function serverBandwidthLabel(value: unknown): string {
  return String(value || "").trim()
}

export function readDefaultProbeChartHours(): HistoryHours {
  return parseHistoryHours(readWindowSetting("DefaultProbeChartHours"))
}

export function readHomeProbeTaskOverrides(): Record<string, number[]> {
  return parseHomeProbeTaskOverrides(readWindowSetting("HomeProbeTasks"))
}
