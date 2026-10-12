export function filterTasksByName(names: string[], query: string): string[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return names
  return names.filter((name) => name.toLowerCase().includes(needle))
}

export function unionTaskNames(current: string[], extra: string[]): string[] {
  const seen = new Set(current)
  const next = [...current]
  for (const name of extra) {
    if (seen.has(name)) continue
    seen.add(name)
    next.push(name)
  }
  return next
}

export function pageSizeForViewport(width: number): number {
  return width <= 967 ? 3 : 6
}

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, pageSize)))
}

export function clampPage(page: number, total: number, pageSize: number): number {
  return Math.min(Math.max(1, page), pageCount(total, pageSize))
}

export function paginateItems<T>(items: T[], page: number, pageSize: number): T[] {
  const safePage = clampPage(page, items.length, pageSize)
  const start = (safePage - 1) * pageSize
  return items.slice(start, start + pageSize)
}

export function compactPageList(page: number, pages: number): Array<number | "ellipsis"> {
  if (pages <= 7) {
    return Array.from({ length: pages }, (_, index) => index + 1)
  }
  const items: Array<number | "ellipsis"> = [1]
  const start = Math.max(2, page - 1)
  const end = Math.min(pages - 1, page + 1)
  if (start > 2) items.push("ellipsis")
  for (let value = start; value <= end; value++) items.push(value)
  if (end < pages - 1) items.push("ellipsis")
  items.push(pages)
  return items
}
