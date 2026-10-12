import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  clampPage,
  compactPageList,
  filterTasksByName,
  pageCount,
  pageSizeForViewport,
  paginateItems,
  unionTaskNames,
} from "../src/lib/probe-task-picker.ts"

test("task name search is case-insensitive and matches inner fragments", () => {
  const names = ["VMRack_LAX_L3_02 内网", "VMRack_LAX_L3_02 公网", "GreenCloud_SG"]
  assert.deepEqual(filterTasksByName(names, " l3_02 "), ["VMRack_LAX_L3_02 内网", "VMRack_LAX_L3_02 公网"])
  assert.deepEqual(filterTasksByName(names, "GREEN"), ["GreenCloud_SG"])
  assert.deepEqual(filterTasksByName(names, ""), names)
})

test("selecting visible results keeps tasks outside the current search", () => {
  const next = unionTaskNames(["GreenCloud_SG"], ["VMRack_LAX_L3_02 内网", "VMRack_LAX_L3_02 公网"])
  assert.deepEqual(next, ["GreenCloud_SG", "VMRack_LAX_L3_02 内网", "VMRack_LAX_L3_02 公网"])
})

test("picker footer copy is short and delay stays inside the search inset", () => {
  const zh = JSON.parse(readFileSync(new URL("../src/locales/zh-CN/translation.json", import.meta.url), "utf8"))
  const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8")
  const picker = readFileSync(new URL("../src/components/NetworkTaskPicker.tsx", import.meta.url), "utf8")
  assert.equal(zh.monitor.selectAllResults, "全选")
  assert.equal(zh.monitor.clearSelected, "清空")
  assert.match(css, /--lite-picker-inset: 18px/)
  assert.match(css, /\.lite-task-picker__body \{[\s\S]*padding: 0 var\(--lite-picker-inset\)/)
  assert.match(css, /\.lite-task-picker__search \{[\s\S]*width: 100%/)
  assert.match(css, /\.lite-task-picker__list \{[\s\S]*padding: 0/)
  assert.match(css, /\.lite-task-picker__item \{[\s\S]*padding: 10px 0/)
  assert.match(picker, /lite-task-picker__hint/)
  assert.match(picker, /lite-task-picker__body/)
  assert.doesNotMatch(picker, /placeholder=\{/)
  assert.doesNotMatch(picker, /type="search"/)
  assert.match(css, /--font-sans: "Public Sans", "Public Sans Variable", "Microsoft YaHei"/)
  assert.match(css, /\.lite-task-picker__hint \{[\s\S]*Microsoft YaHei[\s\S]*font-size: 13px/)
  assert.match(css, /\.lite-task-picker__name \{[\s\S]*font-size: 13px/)
})

test("pagination uses 6 desktop rows and 3 phone rows", () => {
  assert.equal(pageSizeForViewport(1920), 6)
  assert.equal(pageSizeForViewport(967), 3)
  assert.equal(pageCount(24, 6), 4)
  assert.equal(clampPage(9, 24, 6), 4)
  assert.deepEqual(paginateItems(["a", "b", "c", "d", "e", "f", "g"], 2, 6), ["g"])
  assert.deepEqual(compactPageList(1, 4), [1, 2, 3, 4])
  assert.deepEqual(compactPageList(5, 12), [1, "ellipsis", 4, 5, 6, "ellipsis", 12])
})
