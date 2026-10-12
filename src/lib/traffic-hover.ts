export function trafficHoverIndex(clientX: number, left: number, width: number, count: number): number {
  if (count <= 1) return 0
  const ratio = Math.min(1, Math.max(0, (clientX - left) / Math.max(1, width)))
  return Math.round(ratio * (count - 1))
}

export function trafficHoverLeftPercent(index: number, count: number): number {
  if (count <= 1) return 50
  return (index / (count - 1)) * 100
}

export function trafficHoverAlign(index: number, count: number): "start" | "center" | "end" {
  if (count <= 1) return "center"
  const ratio = index / (count - 1)
  if (ratio <= 0.18) return "start"
  if (ratio >= 0.82) return "end"
  return "center"
}
