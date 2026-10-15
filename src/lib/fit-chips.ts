export function toggleFocusedTask(current: string[], name: string): string[] {
  return current.includes(name) ? current.filter((item) => item !== name) : [...current, name]
}

export function visibleProbeTasks(active: string[], focused: string[]): string[] {
  if (focused.length === 0) return active
  const selected = new Set(focused)
  const visible = active.filter((name) => selected.has(name))
  return visible.length > 0 ? visible : active
}

export function retainFocusedTasks(current: string[], active: string[]): string[] {
  const next = current.filter((name) => active.includes(name))
  return next.length === current.length ? current : next
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
