import assert from "node:assert/strict"
import test from "node:test"

import { ANCHORS, anchorRect, circleHitsRect, overlayRect, placeLabels, type LabelItem, type PlacedLabel } from "../src/lib/fleet-flat-labels.ts"

const BOUNDS = { w: 1200, h: 490 }
const NAME = { w: 34, h: 16 }
const FULL = { w: 92, h: 25 }
const item = (key: string, x: number, y: number, extra: Partial<LabelItem> = {}): LabelItem => ({
  key,
  x,
  y,
  r: 7,
  name: NAME,
  full: FULL,
  priority: 1,
  ...extra,
})
const overlap = (a: PlacedLabel, b: PlacedLabel) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

function assertClean(items: LabelItem[], placed: PlacedLabel[]) {
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) assert.ok(!overlap(placed[i], placed[j]), `${placed[i].key} overlaps ${placed[j].key}`)
  }
  for (const p of placed) {
    assert.ok(p.x >= 0 && p.y >= 0 && p.x + p.w <= BOUNDS.w && p.y + p.h <= BOUNDS.h, `${p.key} is inside the map`)
    for (const o of items) assert.ok(!circleHitsRect(o.x, o.y, o.r, p), `${p.key} covers the dot of ${o.key}`)
  }
}

test("a lone city gets a full label right next to its dot", () => {
  const items = [item("西雅图", 300, 200)]
  const [p] = placeLabels(items, BOUNDS)
  assert.equal(p.mode, "full")
  assert.equal(p.anchor, 0, "upper right first")
  assert.ok(p.x > 300 && p.x - 300 < 12 && Math.abs(p.y + p.h - 200) < 12)
})

test("Sydney and Melbourne, 20px apart: both labelled, neither covers the other's dot, each stays beside its own dot", () => {
  const items = [item("墨尔本", 1038, 408, { priority: 2 }), item("悉尼", 1058, 396, { priority: 1 })]
  const placed = placeLabels(items, BOUNDS)
  assert.equal(placed.length, 2)
  assertClean(items, placed)
  for (const p of placed) {
    const it = items.find((i) => i.key === p.key)!
    const cx = Math.max(p.x, Math.min(it.x, p.x + p.w))
    const cy = Math.max(p.y, Math.min(it.y, p.y + p.h))
    assert.ok(Math.hypot(cx - it.x, cy - it.y) < 12, `${p.key} is within 12px of its own dot`)
  }
})

test("East Asia at world zoom (cities 6 to 35px apart) keeps every label clean", () => {
  const items = [
    item("沈阳", 1007, 150, { priority: 3 }),
    item("西安", 960, 190, { priority: 4 }),
    item("十堰", 966, 196, { priority: 5 }),
    item("香港", 977, 232, { priority: 6 }),
    item("大阪", 1047, 187, { priority: 2 }),
    item("东京", 1061, 178, { priority: 7 }),
  ]
  const placed = placeLabels(items, BOUNDS)
  assertClean(items, placed)
  assert.ok(placed.length >= 5, `most cities keep a name, got ${placed.length}`)
})

test("a pile of dots on the same pixel keeps the top-priority label and hides the rest instead of overlapping", () => {
  const items = Array.from({ length: 6 }, (_, i) => item(`n${i}`, 500 + i, 300, { priority: 10 - i }))
  const placed = placeLabels(items, BOUNDS)
  assert.ok(placed.length >= 1 && placed.length < 6)
  assert.equal(placed[0].key, "n0")
  assertClean(items, placed)
})

test("the selected city is always shown in full, even when it has to sit on top of others", () => {
  const items = Array.from({ length: 8 }, (_, i) => item(`n${i}`, 500 + i * 2, 300, { priority: 10 - i }))
  items.push(item("选中", 507, 300, { priority: 0, pinned: true }))
  const placed = placeLabels(items, BOUNDS)
  const mine = placed.find((p) => p.key === "选中")
  assert.ok(mine && mine.mode === "full")
})

test("a city near the right edge flips its label to the left; near the top it goes below", () => {
  const right = placeLabels([item("东京", 1190, 200)], BOUNDS)[0]
  assert.ok(right.x + right.w <= BOUNDS.w - 2 && right.x < 1190)
  const top = placeLabels([item("极地", 600, 6)], BOUNDS)[0]
  assert.ok(top.y >= 2 && top.y > 6 - 1)
})

test("labels upgrade to full only where there is room, and the anchor does not move when they upgrade", () => {
  const crowded = [item("a", 500, 300, { priority: 2 }), item("b", 560, 300, { priority: 1 })]
  const tight = placeLabels(crowded, BOUNDS)
  assert.ok(tight.some((p) => p.mode === "name"))
  const roomy = placeLabels([item("a", 300, 300, { priority: 2 }), item("b", 800, 300, { priority: 1 })], BOUNDS)
  assert.ok(roomy.every((p) => p.mode === "full"))
  const nameOnly = placeLabels([item("a", 300, 300, { full: NAME })], BOUNDS)[0]
  assert.equal(nameOnly.w, NAME.w)
  assert.equal(nameOnly.mode, "name", "no speed row means it is never marked full, so nothing extra gets drawn")
  const pinnedNoSpeed = placeLabels([item("a", 300, 300, { full: NAME, pinned: true })], BOUNDS)[0]
  assert.equal(pinnedNoSpeed.mode, "name")
  const before = placeLabels([item("a", 300, 300, { full: NAME })], BOUNDS)[0]
  const after = placeLabels([item("a", 300, 300)], BOUNDS)[0]
  assert.equal(before.anchor, after.anchor)
})

test("the layout is deterministic and does not depend on input order", () => {
  const items = [item("a", 500, 300, { priority: 3 }), item("b", 515, 305, { priority: 2 }), item("c", 530, 296, { priority: 1 })]
  const one = placeLabels(items, BOUNDS)
  const two = placeLabels(items.slice().reverse(), BOUNDS)
  assert.deepEqual(one, two)
  assert.deepEqual(placeLabels(items, BOUNDS), one)
})

test("previous anchors are reused when they still fit, so labels do not hop around while panning", () => {
  const items = [item("a", 600, 300)]
  const first = placeLabels(items, BOUNDS)[0]
  const forced = placeLabels(items, BOUNDS, new Map([["a", 3]]))[0]
  assert.equal(forced.anchor, 3)
  assert.notEqual(first.anchor, forced.anchor)
  const moved = placeLabels([item("a", 610, 305)], BOUNDS, new Map([["a", forced.anchor]]))[0]
  assert.equal(moved.anchor, forced.anchor)
})

test("the hover callout stays on screen and prefers the label's current side", () => {
  const it = item("东京", 1190, 200)
  const rect = overlayRect(it, BOUNDS)
  assert.ok(rect.x + rect.w <= BOUNDS.w - 2)
  const mid = item("x", 600, 300)
  assert.deepEqual(overlayRect(mid, BOUNDS, 3), anchorRect(mid, mid.full, 3))
  assert.equal(ANCHORS.length, 8)
})
