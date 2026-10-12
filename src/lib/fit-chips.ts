export function toggleFocusedTask(current: string | null, name: string): string | null {
  return current === name ? null : name
}

export function countFittingChips(widths: number[], budget: number, gap: number, moreWidth: number): number {
  if (widths.length === 0 || budget <= 0) return 0
  const all = widths.reduce((sum, width, index) => sum + width + (index > 0 ? gap : 0), 0)
  if (all <= budget) return widths.length

  let used = 0
  let count = 0
  for (let index = 0; index < widths.length; index++) {
    const next = used + (count > 0 ? gap : 0) + widths[index]
    const extra = index < widths.length - 1 ? gap + moreWidth : 0
    if (next + extra > budget && count > 0) break
    used = next
    count += 1
  }
  return Math.max(1, count)
}
