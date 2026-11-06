import assert from "node:assert/strict"
import test from "node:test"

import { MAX_SCREEN_PITCH, PITCH_LEVELS, forEachLandDot, isLand, maxScreenPitch, pickPitch, type LandMask } from "../src/lib/world-dots.ts"

/** 0.5 度一格的合成掩膜：predicate(lon, lat) 为真的格子是陆地。 */
function makeMask(predicate: (lon: number, lat: number) => boolean): LandMask {
  const w = 720
  const h = 360
  const data = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = predicate(-180 + (x + 0.5) * 0.5, 90 - (y + 0.5) * 0.5) ? 255 : 0
  return { w, h, data }
}
const ALL = makeMask(() => true)
const WEST = makeMask((lon) => lon < 0)
const WORLD = { lonMin: -180, lonMax: 180, latMin: -90, latMax: 90 }
const collect = (mask: LandMask, pitch: number, win: typeof WORLD, equalArea: boolean) => {
  const out: Array<[number, number]> = []
  forEachLandDot(mask, pitch, win, equalArea, (lon, lat) => out.push([lon, lat]))
  return out
}

test("isLand wraps longitude and treats out-of-range latitude as sea", () => {
  assert.equal(isLand(WEST, -90, 10), true)
  assert.equal(isLand(WEST, 90, 10), false)
  assert.equal(isLand(WEST, -90 + 360, 10), true, "longitude wraps")
  assert.equal(isLand(WEST, -90 - 360, 10), true)
  assert.equal(isLand(ALL, 0, 90.5), false)
  assert.equal(isLand(ALL, 0, -91), false)
  assert.equal(isLand(ALL, 180, 0), true)
  assert.equal(isLand(ALL, -180, 0), true)
})

test("the pitch gets finer as the map is zoomed in, and the on-screen spacing stays in a narrow band", () => {
  let last = Infinity
  for (const px of [1.5, 2.5, 3.3, 3.9, 5.2, 8, 12.7, 20, 30]) {
    const p = pickPitch(px)
    assert.ok(p <= last, `pitch never grows with zoom (${px})`)
    last = p
    const cap = maxScreenPitch(px)
    if (p > PITCH_LEVELS[PITCH_LEVELS.length - 1]) assert.ok(p * px <= cap + 1e-9, `${px}px/deg gives ${p * px}px`)
    if (p < PITCH_LEVELS[0]) assert.ok(p * px > cap / Math.SQRT2 - 1e-9, `${px}px/deg is not needlessly fine: ${p * px}px`)
  }
  assert.equal(pickPitch(0.1), PITCH_LEVELS[0])
  assert.equal(pickPitch(1000), PITCH_LEVELS[PITCH_LEVELS.length - 1])
  // 平面地图世界视图（约 3.3px/度）和地球仪（约 3.9px/度）的点距约 4px；放大到区域级（约 12px/度）放宽到 5px 以上
  assert.ok(pickPitch(3.3) * 3.3 >= 3.4 && pickPitch(3.9) * 3.9 >= 3.4)
  assert.equal(maxScreenPitch(3), MAX_SCREEN_PITCH)
  assert.equal(maxScreenPitch(100), 7.5)
  assert.ok(pickPitch(12.7) * 12.7 > 4.9, "zoomed-in views get airier dots")
})

test("only land cells become dots", () => {
  const dots = collect(WEST, 1.2, WORLD, false)
  assert.ok(dots.length > 1000)
  for (const [lon, lat] of dots) {
    assert.ok(isLand(WEST, lon, lat))
    const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180 // 180 与 -180 是同一个位置
    assert.ok(wrapped < 0 && lat >= -90 && lat <= 90)
  }
  assert.equal(collect(makeMask(() => false), 1.2, WORLD, true).length, 0)
})

test("the flat lattice is uniform: every row has the same number of dots and odd rows are shifted by half a step", () => {
  const dots = collect(ALL, 1.2, WORLD, false)
  const rows = new Map<number, number[]>()
  for (const [lon, lat] of dots) rows.set(lat, [...(rows.get(lat) ?? []), lon])
  const counts = new Set([...rows.values()].map((r) => r.length))
  assert.equal(counts.size, 1)
  const sorted = [...rows.entries()].sort((a, b) => a[0] - b[0])
  const step = 360 / sorted[0][1].length
  const first = sorted.map(([, lons]) => Math.min(...lons))
  assert.ok(Math.abs(first[1] - first[0] - step / 2) < 1e-9 || Math.abs(first[1] - first[0] + step / 2) < 1e-9)
  assert.ok(Math.abs(first[2] - first[0]) < 1e-9)
})

test("the equal-area lattice has the same dot density per area at every latitude (no crowding at the poles)", () => {
  const dots = collect(ALL, 0.6, WORLD, true)
  const band = (lo: number, hi: number) => dots.filter(([, lat]) => lat >= lo && lat < hi).length
  const area = (lo: number, hi: number) => Math.sin((hi * Math.PI) / 180) - Math.sin((lo * Math.PI) / 180)
  const equator = band(0, 10) / area(0, 10)
  for (const [lo, hi] of [
    [30, 40],
    [60, 70],
    [75, 85],
  ]) {
    const ratio = band(lo, hi) / area(lo, hi) / equator
    assert.ok(ratio > 0.8 && ratio < 1.25, `density at ${lo}-${hi} is ${ratio.toFixed(2)}x the equator`)
  }
})

test("the lattice does not depend on the window: a smaller window gives exactly the dots of the bigger one that fall inside", () => {
  const key = ([lon, lat]: [number, number]) => `${lon.toFixed(9)},${lat.toFixed(9)}`
  for (const equalArea of [false, true]) {
    const big = new Set(collect(ALL, 0.85, WORLD, equalArea).map(key))
    const win = { lonMin: 100, lonMax: 150, latMin: 10, latMax: 50 }
    const small = collect(ALL, 0.85, win, equalArea)
    assert.ok(small.length > 100)
    for (const d of small) assert.ok(big.has(key(d)), `dot ${key(d)} (equalArea=${equalArea}) also exists in the full lattice`)
    const expected = collect(ALL, 0.85, WORLD, equalArea).filter(([lon, lat]) => lon >= win.lonMin && lon <= win.lonMax && lat >= win.latMin && lat <= win.latMax)
    const got = new Set(small.map(key))
    for (const d of expected) assert.ok(got.has(key(d)), `dot ${key(d)} inside the window is not missed`)
  }
})

test("windows that wrap past 180 degrees still produce the dots on both sides", () => {
  const win = { lonMin: 170, lonMax: 200, latMin: -10, latMax: 10 }
  const dots = collect(ALL, 1.2, win, false)
  assert.ok(dots.some(([lon]) => lon > 180) || dots.some(([lon]) => lon < -170))
  assert.ok(dots.length > 50)
})

test("the dot count stays bounded, so a repaint is cheap at any zoom", () => {
  const world = collect(ALL, pickPitch(3.9), WORLD, true).length
  assert.ok(world < 60000, `${world} lattice dots over the whole sphere at world zoom`)
})
