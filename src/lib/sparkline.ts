export function seriesPath(values: number[], width: number, height: number, padY = 18, padBottom = 24, domain?: { min: number; max: number }): { line: string; area: string; points: Array<{ x: number; y: number }> } {
  if (values.length === 0) return { line: "", area: "", points: [] }
  const min = domain?.min ?? Math.min(...values, 0)
  const max = domain?.max ?? Math.max(...values, 1)
  const range = Math.max(1e-6, max - min)
  const plotBottom = height - padBottom
  const points = values.map((value, index) => {
    const x = values.length === 1 ? width : (index / (values.length - 1)) * width
    const y = padY + (1 - (value - min) / range) * (plotBottom - padY)
    return { x, y }
  })
  if (values.every((value) => value === 0)) return { line: "", area: "", points }
  const line = points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ")
  const last = points.at(-1)!
  const area = `${line} L${last.x.toFixed(1)} ${plotBottom} L0 ${plotBottom} Z`
  return { line, area, points }
}

export function dualSeriesDomain(up: number[], down: number[]): { min: number; max: number } {
  const values = [...up, ...down]
  if (values.length === 0) return { min: 0, max: 1 }
  return { min: Math.min(0, ...values), max: Math.max(1, ...values) }
}
