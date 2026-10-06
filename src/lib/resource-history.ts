export type ResourceTotals = {
  memTotal: number
  diskTotal: number
  swapTotal: number
}

export type ResourceSample = {
  time: number
  value: number
}

export type ResourceHistoryPoint = {
  timeStamp: number
  cpu: number | null
  memory: number | null
  swap: number | null
  storage: number | null
  tcp: number | null
  udp: number | null
}

export function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0))
}

export function usagePercent(used: number, total: number): number | null {
  if (!Number.isFinite(used) || used < 0) return null
  if (!Number.isFinite(total) || total <= 0) {
    return used <= 100 ? clampPercent(used) : null
  }
  return clampPercent((used / total) * 100)
}

function sampleMap(samples: ResourceSample[]): Map<number, number> {
  const map = new Map<number, number>()
  for (const sample of samples) {
    if (!Number.isFinite(sample.time) || !Number.isFinite(sample.value)) continue
    map.set(sample.time, sample.value)
  }
  return map
}

function countValue(value: number | undefined): number | null {
  if (value === undefined || !Number.isFinite(value) || value < 0) return null
  return value
}

export function mergeResourceSeries(
  cpu: ResourceSample[],
  memoryUsed: ResourceSample[],
  diskUsed: ResourceSample[],
  totals: ResourceTotals,
  extra: {
    swapUsed?: ResourceSample[]
    tcp?: ResourceSample[]
    udp?: ResourceSample[]
  } = {},
): ResourceHistoryPoint[] {
  const cpuMap = sampleMap(cpu)
  const memoryMap = sampleMap(memoryUsed)
  const swapMap = sampleMap(extra.swapUsed || [])
  const diskMap = sampleMap(diskUsed)
  const tcpMap = sampleMap(extra.tcp || [])
  const udpMap = sampleMap(extra.udp || [])
  const times = [
    ...new Set([
      ...cpuMap.keys(),
      ...memoryMap.keys(),
      ...swapMap.keys(),
      ...diskMap.keys(),
      ...tcpMap.keys(),
      ...udpMap.keys(),
    ]),
  ].sort((a, b) => a - b)

  return times.map((timeStamp) => {
    const cpuValue = cpuMap.get(timeStamp)
    const memoryValue = memoryMap.get(timeStamp)
    const swapValue = swapMap.get(timeStamp)
    const diskValue = diskMap.get(timeStamp)
    return {
      timeStamp,
      cpu: cpuValue === undefined ? null : clampPercent(cpuValue),
      memory: memoryValue === undefined ? null : usagePercent(memoryValue, totals.memTotal),
      swap: swapValue === undefined ? null : usagePercent(swapValue, totals.swapTotal),
      storage: diskValue === undefined ? null : usagePercent(diskValue, totals.diskTotal),
      tcp: countValue(tcpMap.get(timeStamp)),
      udp: countValue(udpMap.get(timeStamp)),
    }
  })
}
