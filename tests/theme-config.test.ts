import assert from "node:assert/strict"
import test from "node:test"

import { parseHistoryHours } from "../src/lib/history-range.ts"
import { readDefaultProbeChartHours, readShowHomePacketLoss, readShowServerBandwidth, readShowServerRemainingValue, readThemeBoolean, serverBandwidthLabel } from "../src/lib/theme-config.ts"

test("bandwidth display defaults off and ignores blank values", () => {
  assert.equal(readShowServerBandwidth(), false)
  assert.equal(readThemeBoolean("ShowServerBandwidth", false), false)
  assert.equal(serverBandwidthLabel("  1 Gbps  "), "1 Gbps")
  assert.equal(serverBandwidthLabel("   "), "")
  assert.equal(serverBandwidthLabel(undefined), "")
  assert.equal(readShowHomePacketLoss(), false)
  assert.equal(readShowServerRemainingValue(), true)
})

test("probe chart hours parse labels used by the theme setting", () => {
  assert.equal(parseHistoryHours(undefined), 1)
  assert.equal(parseHistoryHours(""), 1)
  assert.equal(parseHistoryHours("nope"), 1)
  assert.equal(parseHistoryHours("1h"), 1)
  assert.equal(parseHistoryHours("24h"), 24)
  assert.equal(parseHistoryHours("3d"), 72)
  assert.equal(parseHistoryHours("30d"), 720)
  assert.equal(parseHistoryHours(24), 24)
})

test("default probe chart hours follow the theme window setting", () => {
  const previous = globalThis.window
  const fake = { DefaultProbeChartHours: "24h" } as Window & typeof globalThis
  Object.defineProperty(globalThis, "window", { configurable: true, value: fake, writable: true })
  try {
    assert.equal(readDefaultProbeChartHours(), 24)
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: previous, writable: true })
  }
})
