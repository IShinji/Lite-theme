import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const detailSource = readFileSync(new URL("../src/pages/ServerDetail.tsx", import.meta.url), "utf8")
const chartSource = readFileSync(new URL("../src/components/NetworkChart.tsx", import.meta.url), "utf8")

test("keeps the inactive network panel measurable before its first display", () => {
  assert.doesNotMatch(detailSource, /display:\s*currentTab/)
  assert.match(detailSource, /data-testid="server-network-panel"/)
  assert.match(detailSource, /relative w-full overflow-hidden/)
  assert.match(detailSource, /pointer-events-none absolute inset-x-0 top-0 overflow-hidden opacity-0/)
})

test("keeps the network chart canvas mounted during initial data loading", () => {
  assert.match(chartSource, /data-testid="network-chart-canvas"/)
  assert.match(chartSource, /data=\{hasChartData \? processedData : \[\]\}/)
  assert.match(chartSource, /!hasChartData &&/)
  assert.match(chartSource, /hasChartData \? "opacity-100" : "pointer-events-none absolute inset-0 opacity-0"/)
})

test("prefetches monitor data on the detail page and only refetches while the network tab is visible", () => {
  assert.match(chartSource, /enabled:\s*true/)
  assert.match(chartSource, /refetchOnWindowFocus:\s*false/)
  assert.match(chartSource, /refetchInterval:\s*show\s*\?/)
  assert.doesNotMatch(chartSource, /enabled:\s*show/)
})

test("lists assigned probe tasks even when no samples have arrived", () => {
  assert.match(chartSource, /mergeAssignedPingMonitors|hasTasks/)
  assert.match(chartSource, /monitor.noSamples/)
  assert.match(chartSource, /const showTaskLayout = hasTasks && !hasError/)
  assert.match(chartSource, /min-h-\[120px\] items-center justify-center/)
})

test("keeps network header actions on the same row as titles on mobile", () => {
  assert.match(chartSource, /monitor\.allTasks/)
  assert.doesNotMatch(chartSource, /flex flex-col gap-2 space-y-0 px-4 py-3 sm:flex-row/)
  assert.match(chartSource, /flex flex-row items-center justify-between gap-2 space-y-0 px-5 py-4/)
  assert.match(chartSource, /flexShrink: 0/)
})

test("exits initial loading state and offers retry after a query failure", () => {
  assert.match(chartSource, /const isLoading = waitingForChart \|\| \(isPending && !hasTasks\)/)
  assert.match(chartSource, /const hasInitialError = isError && !monitorData/)
  assert.match(chartSource, /hasError=\{hasInitialError\}/)
  assert.match(chartSource, /onClick=\{onRetry\}/)
})
