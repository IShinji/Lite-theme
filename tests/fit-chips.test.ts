import assert from "node:assert/strict"
import test from "node:test"

import { countFittingChips, retainFocusedTasks, toggleFocusedTask, visibleProbeTasks } from "../src/lib/fit-chips.ts"

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

test("chip click adds a task and click again removes it", () => {
  assert.deepEqual(toggleFocusedTask([], "A"), ["A"])
  assert.deepEqual(toggleFocusedTask(["A"], "B"), ["A", "B"])
  assert.deepEqual(toggleFocusedTask(["A", "B"], "A"), ["B"])
  assert.deepEqual(toggleFocusedTask(["B"], "B"), [])
})

test("empty chip focus shows every picker task", () => {
  assert.deepEqual(visibleProbeTasks(["A", "B", "C"], []), ["A", "B", "C"])
})

test("focused chips keep picker order and drop tasks no longer in the picker", () => {
  assert.deepEqual(visibleProbeTasks(["A", "B", "C"], ["C", "A"]), ["A", "C"])
  assert.deepEqual(visibleProbeTasks(["B"], ["A", "C"]), ["B"])
})

test("drops focused chips that left the picker without allocating when nothing changed", () => {
  const current = ["A", "B"]
  assert.equal(retainFocusedTasks(current, ["A", "B", "C"]), current)
  assert.deepEqual(retainFocusedTasks(current, ["B"]), ["B"])
})
