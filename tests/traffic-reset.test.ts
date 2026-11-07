import assert from "node:assert/strict"
import test from "node:test"

import { daysUntilTrafficReset } from "../src/lib/trafficReset.ts"

test("有 traffic_reset_at 时按真实时刻向上取整，与「剩余天数」口径一致", () => {
  // 西雅图 11-07 17:17 重置；此刻西雅图 11-06 17:41（后端折成东八区下发的 reset_day 是 8）
  const resetAt = "2026-11-07T17:17:00-08:00"
  const now = new Date("2026-11-06T17:41:00-08:00")
  assert.equal(daysUntilTrafficReset(8, now, resetAt), 1)
})

test("浏览器时区不影响结果", () => {
  const resetAt = "2026-11-07T17:17:00-08:00"
  const now = new Date("2026-11-07T09:41:00+08:00") // 同一时刻
  assert.equal(daysUntilTrafficReset(8, now, resetAt), 1)
})

test("刚好跨过一天后变成 2，不足一小时也算 1 而不是 0", () => {
  const resetAt = "2026-11-07T17:17:00-08:00"
  assert.equal(daysUntilTrafficReset(8, new Date("2026-11-06T17:16:00-08:00"), resetAt), 2)
  assert.equal(daysUntilTrafficReset(8, new Date("2026-11-07T16:30:00-08:00"), resetAt), 1)
})

test("重置时刻已过或 reset_at 无效时退回按日期算", () => {
  const now = new Date("2026-11-06T12:00:00Z")
  assert.equal(daysUntilTrafficReset(8, now, "垃圾"), daysUntilTrafficReset(8, now))
  assert.equal(daysUntilTrafficReset(8, now, "2026-11-01T00:00:00Z"), daysUntilTrafficReset(8, now))
})

test("没有 reset_day 也没有 reset_at 时不显示", () => {
  assert.equal(daysUntilTrafficReset(undefined, new Date()), undefined)
})

test("reset_at 存在而 reset_day 缺失也能显示", () => {
  assert.equal(daysUntilTrafficReset(undefined, new Date("2026-11-06T17:41:00-08:00"), "2026-11-07T17:17:00-08:00"), 1)
})
