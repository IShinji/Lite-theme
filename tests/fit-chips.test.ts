import assert from "node:assert/strict"
import test from "node:test"

import { countFittingChips, toggleFocusedTask } from "../src/lib/fit-chips.ts"

test("shows every chip when they all fit", () => {
  assert.equal(countFittingChips([80, 90, 70], 400, 8, 40), 3)
})

test("keeps a +n control when the last chips overflow", () => {
  assert.equal(countFittingChips([80, 80, 80], 220, 8, 40), 2)
})

test("still shows one chip when the row is tight", () => {
  assert.equal(countFittingChips([120, 120], 100, 8, 40), 1)
})

test("returns zero for an empty list", () => {
  assert.equal(countFittingChips([], 200, 8, 40), 0)
})

test("chip click focuses one task and click again clears it", () => {
  assert.equal(toggleFocusedTask(null, "CM"), "CM")
  assert.equal(toggleFocusedTask("CM", "CM"), null)
  assert.equal(toggleFocusedTask("CM", "test"), "test")
})
