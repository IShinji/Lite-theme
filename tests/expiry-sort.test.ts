import assert from "node:assert/strict"
import test from "node:test"

import { compareByExpiry, expiryTimestamp } from "../src/lib/expiry-sort.ts"

const node = (name: string, expired_at: string | null | undefined, display_index = 0) => ({ name, expired_at, display_index })
const sorted = (list: ReturnType<typeof node>[]) => [...list].sort(compareByExpiry).map((n) => n.name)

test("the soonest expiry comes first", () => {
  const list = [node("c", "2026-12-01T00:00:00Z"), node("a", "2026-11-03T00:00:00Z"), node("b", "2026-11-20T00:00:00Z")]
  assert.deepEqual(sorted(list), ["a", "b", "c"])
})

test("nodes with no expiry date, an empty one, or a long-term one go last", () => {
  const list = [node("none", null), node("late", "2027-04-19T00:00:00Z"), node("empty", ""), node("long", "0000-00-00T23:59:59+08:00"), node("far", "9999-12-31T00:00:00Z"), node("soon", "2026-11-03T00:00:00Z")]
  const out = sorted(list)
  assert.deepEqual(out.slice(0, 2), ["soon", "late"])
  assert.deepEqual([...out.slice(2)].sort(), ["empty", "far", "long", "none"])
})

test("ties and the no-expiry group keep the theme's default order (display_index)", () => {
  const list = [node("b", null, 2), node("a", null, 1), node("y", "2026-11-03T00:00:00Z", 5), node("x", "2026-11-03T00:00:00Z", 3)]
  assert.deepEqual(sorted(list), ["x", "y", "a", "b"])
})

test("an unparseable date is treated as no expiry, never throws", () => {
  assert.equal(expiryTimestamp("not a date"), null)
  assert.equal(expiryTimestamp(undefined), null)
  assert.equal(expiryTimestamp("2026-11-03T00:00:00Z"), Date.parse("2026-11-03T00:00:00Z"))
  assert.doesNotThrow(() => sorted([node("a", "garbage"), node("b", "2026-11-03T00:00:00Z")]))
})

test("an already expired node is the first one (it is the most urgent)", () => {
  assert.deepEqual(sorted([node("future", "2027-01-01T00:00:00Z"), node("past", "2025-01-01T00:00:00Z")]), ["past", "future"])
})

import { readFileSync } from "node:fs"

test("the expiry sort is wired into the sort type list, the home dropdown, compareHomeServers and every language", () => {
  const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")
  assert.match(read("src/context/sort-context.ts"), /"expiry"/)
  assert.match(read("src/pages/Server.tsx"), /value: "expiry", labelKey: "home\.sortExpiry"/)
  const sort = read("src/lib/theme-home-sort.ts")
  assert.match(sort, /sortType === "expiry"\) return compareByExpiry\(a, b\)/)
  // 到期排序必须在「离线靠后」的规则之前直接返回，否则离线节点会被挪到最后
  assert.ok(sort.indexOf('sortType === "expiry"') < sort.indexOf("aInfo.online !== bInfo.online"))
  for (const lang of ["zh-CN", "zh-TW", "en", "ja"]) {
    const t = JSON.parse(read(`src/locales/${lang}/translation.json`))
    assert.ok(typeof t.home.sortExpiry === "string" && t.home.sortExpiry.length > 0, `${lang} 缺 home.sortExpiry`)
  }
})
