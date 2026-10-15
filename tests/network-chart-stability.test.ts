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
  assert.match(chartSource, /hasChartData \? "h-\[275px\] sm:h-\[350px\]" : "h-\[188px\] sm:h-\[250px\]"/)
})

test("prefetches monitor data on the detail page and only refetches while the network tab is visible", () => {
  assert.match(chartSource, /enabled:\s*true/)
  assert.match(chartSource, /refetchOnWindowFocus:\s*false/)
  assert.match(chartSource, /refetchInterval:\s*show\s*\?/)
  assert.doesNotMatch(chartSource, /enabled:\s*show/)
})

test("does not treat the open right edge as a missing band while the page sits idle", () => {
  assert.match(chartSource, /fetchedAt=\{dataUpdatedAt\}/)
  assert.doesNotMatch(chartSource, /useMemo\(\(\) => Date\.now\(\), \[chartData\]\)/)
})

test("lists assigned probe tasks even when no samples have arrived", () => {
  assert.match(chartSource, /mergeAssignedPingMonitors|hasTasks/)
  assert.match(chartSource, /monitor.noSamples/)
  assert.match(chartSource, /const showTaskLayout = hasTasks && !hasError/)
  assert.match(chartSource, /min-h-\[120px\] items-center justify-center/)
})

test("keeps network header actions on the same row as titles on mobile", () => {
  assert.match(chartSource, /monitor\.selectTasks/)
  assert.doesNotMatch(chartSource, /flex flex-col gap-2 space-y-0 px-4 py-3 sm:flex-row/)
  assert.match(chartSource, /lite-panel__heading/)
  assert.match(chartSource, /lite-chart-title/)
  assert.match(chartSource, /HistoryTimePills/)
})

test("uses a draft task picker, compact summary, and paged probe details", () => {
  assert.match(chartSource, /setDraftCharts\(\[\.\.\.activeChartsRef\.current\]\)/)
  assert.match(chartSource, /filterTasksByName/)
  assert.match(chartSource, /FitTaskChips/)
  assert.match(chartSource, /toggleFocusedTask/)
  assert.match(chartSource, /visibleProbeTasks/)
  assert.match(chartSource, /taskSummaries.filter\(\(summary\) => visibleCharts.includes\(summary.name\)\)/)
  assert.match(chartSource, /visibleCharts/)
  assert.match(chartSource, /lite-chart-legend/)
  assert.match(chartSource, /lite-chart-context/)
  assert.doesNotMatch(chartSource, /legendLimit/)
  assert.doesNotMatch(chartSource, /max-w-24 truncate/)
  assert.match(chartSource, /pageSize = phone \? 3 : 6/)
  assert.match(chartSource, /lite-route-summary/)
  assert.match(chartSource, /domain=\{\[0, 100\]\}/)
  assert.match(chartSource, /domain=\{\[0, "auto"\]\}/)
  assert.match(chartSource, /width=\{phone \? 52 : 64\}/)
  assert.match(chartSource, /formatDelayAxisTick\(Number\(value\), phone\)/)
  assert.doesNotMatch(chartSource, /toFixed\(phone \? 0 : 2\)/)
})

test("exits initial loading state and offers retry after a query failure", () => {
  assert.match(chartSource, /const isLoading = waitingForChart \|\| \(isPending && !hasTasks\)/)
  assert.match(chartSource, /const hasInitialError = isError && !monitorData/)
  assert.match(chartSource, /hasError=\{hasInitialError\}/)
  assert.match(chartSource, /onClick=\{onRetry\}/)
})

test("probe-task and network-trend headings share the same type size", () => {
  const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8")
  assert.match(css, /\.lite-panel__heading h2,[\s\S]*font-size: 15px/)
  assert.match(css, /\.lite-monitor-summary__title h2 \{[\s\S]*font-size: 15px/)
})
