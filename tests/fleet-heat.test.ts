import assert from "node:assert/strict"
import test from "node:test"

import { heatColor, heatLevel, maxMachines } from "../src/lib/fleet-heat.ts"
import type { City } from "../src/lib/fleet-globe-data.ts"

test("机器越多越热，最多的城市为 1，没有机器为 0", () => {
  assert.equal(heatLevel(0, 5), 0)
  assert.equal(heatLevel(5, 5), 1)
  assert.ok(heatLevel(1, 5) < heatLevel(2, 5) && heatLevel(2, 5) < heatLevel(4, 5))
  assert.ok(heatLevel(9, 5) <= 1)
})

test("所有城市都只有 1 台时不渲染成最热", () => {
  assert.ok(heatLevel(1, 1) < 0.3)
})

test("颜色从青过渡到红，越界会被夹住", () => {
  assert.deepEqual(heatColor(0), [48, 196, 168])
  assert.deepEqual(heatColor(1), [255, 64, 58])
  assert.deepEqual(heatColor(-3), heatColor(0))
  assert.deepEqual(heatColor(7), heatColor(1))
})

test("maxMachines 取各城市节点数的最大值", () => {
  const mk = (n: number) => ({ nodes: Array.from({ length: n }, (_, i) => String(i)) }) as City
  assert.equal(maxMachines([]), 0)
  assert.equal(maxMachines([mk(1), mk(3), mk(2)]), 3)
})
