export function formatBytes(bytes: number, decimals: number = 2) {
  if (!+bytes) return "0 Bytes"

  const k = 1024
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"]

  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`
}

export function formatSpeed(megabytesPerSecond: number): string {
  if (megabytesPerSecond >= 1024) return `${(megabytesPerSecond / 1024).toFixed(2)} G/s`
  if (megabytesPerSecond >= 1) return `${megabytesPerSecond.toFixed(2)} M/s`
  return `${(megabytesPerSecond * 1024).toFixed(2)} K/s`
}

export function splitFormattedMeasure(text: string): { value: string; unit: string } {
  const trimmed = text.trim()
  const match = trimmed.match(/^(.*?)(\s+)(\S+)$/)
  if (!match) return { value: trimmed, unit: "" }
  return { value: match[1], unit: match[3] }
}

export function formatCompactTime(timestamp: number): string {
  const date = new Date(timestamp)
  const month = (date.getMonth() + 1).toString().padStart(2, "0")
  const day = date.getDate().toString().padStart(2, "0")
  return `${month}-${day} ${formatClockTime(timestamp)}`
}

export function formatClockTime(timestamp: number): string {
  const date = new Date(timestamp)
  const hours = date.getHours().toString().padStart(2, "0")
  const minutes = date.getMinutes().toString().padStart(2, "0")
  return `${hours}:${minutes}`
}

export function formatDelayAxisTick(value: number, compact = false): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return ""
  if (compact && Math.abs(n) >= 10) return `${Math.round(n)}ms`
  if (compact) {
    const tenths = Math.round(n * 10) / 10
    return Number.isInteger(tenths) ? `${tenths}ms` : `${tenths.toFixed(1)}ms`
  }
  return `${n.toFixed(2)}ms`
}
