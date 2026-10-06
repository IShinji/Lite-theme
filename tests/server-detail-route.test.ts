import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { isNetworkView, parsePingTaskId, resolveServerRouteId, uuidToNumber } from "../src/lib/server-route.ts"

test("supports both server detail route conventions", () => {
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8")
  const manifest = JSON.parse(readFileSync(new URL("../Lite-theme.json", import.meta.url), "utf8")) as {
    navigation?: { server_detail?: string; server_network?: string; ping_task_parameter?: string }
  }

  assert.match(app, /lite-page-shell/)
  assert.doesNotMatch(app, /PageTransition/)
  assert.match(app, /<Route path="\/instance\/:id" element={<ServerDetail \/>} \/>/)
  assert.equal(manifest.navigation?.server_detail, "/server/{uuid}")
  assert.equal(manifest.navigation?.server_network, "/server/{uuid}?view=network")
  assert.equal(manifest.navigation?.ping_task_parameter, "ping_task")
})

test("resolves UUID and legacy numeric server routes to the same internal ID contract", () => {
  const uuid = "00000000-0000-4000-8000-000000000014"

  assert.equal(resolveServerRouteId(uuid), uuidToNumber(uuid))
  assert.equal(resolveServerRouteId(uuid.toUpperCase()), uuidToNumber(uuid))
  assert.equal(resolveServerRouteId("14"), 14)
  assert.equal(resolveServerRouteId("server14"), null)
})

test("accepts only positive safe ping task IDs", () => {
  assert.equal(parsePingTaskId("1"), 1)
  assert.equal(parsePingTaskId("0"), undefined)
  assert.equal(parsePingTaskId("-1"), undefined)
  assert.equal(parsePingTaskId("task-1"), undefined)
  assert.equal(parsePingTaskId(null), undefined)
})

test("opens the network overview only for the explicit network view", () => {
  assert.equal(isNetworkView("network"), true)
  assert.equal(isNetworkView("detail"), false)
  assert.equal(isNetworkView("Network"), false)
  assert.equal(isNetworkView(""), false)
  assert.equal(isNetworkView(null), false)
})

test("uses one resolved server ID for overview, realtime charts and ping charts", () => {
  const page = readFileSync(new URL("../src/pages/ServerDetail.tsx", import.meta.url), "utf8")
  const overview = readFileSync(new URL("../src/components/ServerDetailOverview.tsx", import.meta.url), "utf8")
  const realtime = readFileSync(new URL("../src/components/ServerDetailChart.tsx", import.meta.url), "utf8")
  const network = readFileSync(new URL("../src/components/NetworkChart.tsx", import.meta.url), "utf8")

  assert.match(page, /useLayoutEffect\(\(\) => \{/)
  assert.match(page, /window\.scrollTo\(\{ top: 0/)
  assert.match(page, /isNetworkView\(searchParams\.get\("view"\)\) \|\| pingTaskId !== undefined/)
  assert.match(page, /setCurrentTab\(openNetworkView \? tabs\[1\] : tabs\[0\]\)/)
  assert.match(page, /<ServerDetailOverview server_id=\{serverId\}/)
  assert.match(page, /<ServerDetailChart server_id=\{serverId\} show=\{currentTab === tabs\[0\]\}/)
  assert.match(page, /<NetworkChart[\s\S]*server_id=\{serverId\}[\s\S]*initialMonitorId=\{pingTaskId\}/)
  assert.match(overview, /size="lg"/)
  assert.match(overview, /text-\[18px\]/)
  assert.match(overview, /flex min-w-0 items-center gap-2\.5/)
  assert.doesNotMatch(overview, /text-\[28px\]/)
  assert.doesNotMatch(overview, /pl-10/)
  const tabSwitch = readFileSync(new URL("../src/components/TabSwitch.tsx", import.meta.url), "utf8")
  assert.match(tabSwitch, /role="tablist"/)
  assert.match(tabSwitch, /setCurrentTab\(tab\)/)
  assert.doesNotMatch(tabSwitch, /@mui\/material\/Tabs/)
  assert.doesNotMatch(tabSwitch, /px-4 text-sm/)
  assert.doesNotMatch(realtime, /Number\(server_id\)/)
  assert.match(realtime, /resource-realtime-\$\{dataKey\}/)
  assert.match(realtime, /serverDetail.resourceUsage/)
  assert.match(realtime, /serverDetail.trafficUsage/)
  assert.match(realtime, /data-testid="traffic-usage-progress"/)
  assert.doesNotMatch(realtime, /size-\[7px\] rounded-full bg-\[#22B573\]/)
  assert.doesNotMatch(realtime, /TrafficStatCard/)
  assert.match(realtime, /data-testid={`resource-history-\$\{dataKey\}`}/)
  assert.match(realtime, /HISTORY_TIME_OPTIONS/)
  assert.match(realtime, /resource-history-title/)
  assert.doesNotMatch(realtime, /onHoursChange/)
  assert.match(network, /formatCompactTime/)
  assert.match(network, /overflow: "hidden"/)
  assert.match(network, /strokeWidth=\{1\.4\}/)
  assert.doesNotMatch(realtime, /accessibilityLayer/)
  assert.doesNotMatch(network, /accessibilityLayer/)
  assert.match(realtime, /fetchResourceHistory/)
  assert.match(realtime, /grid-cols-4/)
  assert.match(realtime, /min-\[1101px\]:grid-cols-4/)
  assert.match(realtime, /min-\[1101px\]:row-span-2/)
  assert.match(realtime, /dataKey="connections"/)
  assert.match(realtime, /serverDetail.swap/)
  assert.match(realtime, /serverDetail.connections/)
  assert.doesNotMatch(realtime, /justUpdated/)
  assert.match(network, /monitorNameForId/)
})
