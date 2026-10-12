import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { pickBestProbeTask } from "../src/lib/probe-route.ts"

const chartSource = readFileSync(new URL("../src/components/NetworkChart.tsx", import.meta.url), "utf8")

test("picks the probe with lower packet loss before lower delay", () => {
  const fujian = {
    name: "福建移动",
    currentDelay: 69,
    packetLoss: 0,
    availability: 100,
    healthy: true,
  }
  const ningbo = {
    name: "宁波移动",
    currentDelay: 40,
    packetLoss: 0.6,
    availability: 99.4,
    healthy: true,
  }
  assert.equal(pickBestProbeTask([ningbo, fujian])?.name, "福建移动")
})

test("uses current delay only when packet loss is the same", () => {
  const slower = {
    name: "slow",
    currentDelay: 80,
    packetLoss: 0,
    availability: 100,
    healthy: true,
  }
  const faster = {
    name: "fast",
    currentDelay: 69,
    packetLoss: 0,
    availability: 100,
    healthy: true,
  }
  assert.equal(pickBestProbeTask([slower, faster])?.name, "fast")
})

test("route summary uses only the best single probe", () => {
  assert.match(chartSource, /pickBestProbeTask\(selectedTaskSummaries\)/)
  assert.match(chartSource, /SplitStrong value=\{overviewMetrics\.bestTask\?\.availability/)
  assert.match(chartSource, /overviewMetrics\.bestTask\?\.samples/)
  assert.doesNotMatch(chartSource, /sampleWindow.*overviewMetrics\.sampleCount/)
  assert.doesNotMatch(
    chartSource,
    /\[t\("monitor\.availability"\), formatPercentage\(overviewMetrics\.availability, 2\)\]/,
  )
})
