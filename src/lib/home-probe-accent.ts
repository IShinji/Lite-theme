export const HOME_PROBE_ACCENTS = [
  { accent: "#159C82", chip: "#EAF7F3" },
  { accent: "#347DDF", chip: "#EDF4FF" },
  { accent: "#8264D5", chip: "#F2EEFC" },
  { accent: "#D45C87", chip: "#FCEFF5" },
] as const

function hashAccentIndex(id: string): number {
  let hash = 2166136261
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) % HOME_PROBE_ACCENTS.length
}

export function compareProbeTaskIds(a: string, b: string): number {
  const left = Number(a)
  const right = Number(b)
  const leftNumeric = Number.isInteger(left) && String(left) === a
  const rightNumeric = Number.isInteger(right) && String(right) === b
  if (leftNumeric && rightNumeric) return left - right
  if (leftNumeric) return -1
  if (rightNumeric) return 1
  return a.localeCompare(b)
}

export function uniqueSortedTaskIds(ids: Iterable<string>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of ids) {
    const id = String(raw || "").trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  out.sort(compareProbeTaskIds)
  return out
}

export function probeAccentIndex(taskId: string, amongIds: readonly string[] = []): number {
  const id = String(taskId || "").trim()
  if (!id) return 0
  if (amongIds.length > 0) {
    const list = uniqueSortedTaskIds(amongIds)
    const rank = list.indexOf(id)
    if (rank >= 0) return rank % HOME_PROBE_ACCENTS.length
  }
  const numeric = Number(id)
  if (Number.isInteger(numeric) && numeric > 0) {
    return (numeric - 1) % HOME_PROBE_ACCENTS.length
  }
  return hashAccentIndex(id)
}

export function probeAccentForTask(taskId: string, amongIds: readonly string[] = []) {
  return HOME_PROBE_ACCENTS[probeAccentIndex(taskId, amongIds)] ?? HOME_PROBE_ACCENTS[0]
}
