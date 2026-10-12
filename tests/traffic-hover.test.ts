import assert from "node:assert/strict"
import test from "node:test"

import { trafficHoverAlign, trafficHoverIndex, trafficHoverLeftPercent } from "../src/lib/traffic-hover.ts"

test("maps the mouse x to the nearest traffic sample", () => {
  assert.equal(trafficHoverIndex(0, 0, 100, 5), 0)
  assert.equal(trafficHoverIndex(50, 0, 100, 5), 2)
  assert.equal(trafficHoverIndex(100, 0, 100, 5), 4)
  assert.equal(trafficHoverIndex(-10, 0, 100, 5), 0)
  assert.equal(trafficHoverIndex(140, 0, 100, 5), 4)
})

test("keeps a single sample in the middle of the chart", () => {
  assert.equal(trafficHoverIndex(80, 0, 100, 1), 0)
  assert.equal(trafficHoverLeftPercent(0, 1), 50)
  assert.equal(trafficHoverLeftPercent(2, 5), 50)
})

test("pins the speed tooltip to the chart edge instead of overflowing", () => {
  assert.equal(trafficHoverAlign(0, 48), "start")
  assert.equal(trafficHoverAlign(24, 48), "center")
  assert.equal(trafficHoverAlign(47, 48), "end")
  assert.equal(trafficHoverAlign(0, 1), "center")
})
