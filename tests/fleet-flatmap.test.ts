import assert from "node:assert/strict"
import test from "node:test"

import { stablePriority } from "../src/lib/fleet-globe-layout.ts"
import {
  FLAT_HOME,
  FLAT_REGIONS,
  FLAT_ZOOM_MAX,
  WORLD_LAT_BOTTOM,
  WORLD_LAT_TOP,
  clampCamera,
  clampZoom,
  fitBounds,
  flatArc,
  flatLayerKey,
  flatProject,
  flatScale,
  normalizeView,
  readStoredView,
  regionsWithCities,
  writeStoredView,
  zoomAt,
} from "../src/lib/fleet-flatmap.ts"

const W = 1200
const H = 490
const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`)

test("the home view fits the whole world and centres it", () => {
  const left = flatProject(0, -180, FLAT_HOME, W, H)
  const right = flatProject(0, 180, FLAT_HOME, W, H)
  const top = flatProject(WORLD_LAT_TOP, 0, FLAT_HOME, W, H)
  const bottom = flatProject(WORLD_LAT_BOTTOM, 0, FLAT_HOME, W, H)
  assert.ok(left.x >= 0 && right.x <= W && top.y >= 0 && bottom.y <= H)
  near((left.x + right.x) / 2, W / 2)
  near((top.y + bottom.y) / 2, H / 2)
  assert.ok(right.x - left.x > W * 0.95, "the map fills the width")
})

test("the world is fixed: South America stays in one piece on the left, Asia on the right, nothing wraps", () => {
  const sp = flatProject(-23.5, -46.6, FLAT_HOME, W, H)
  const frankfurt = flatProject(50.1, 8.7, FLAT_HOME, W, H)
  const tokyo = flatProject(35.7, 139.7, FLAT_HOME, W, H)
  assert.ok(sp.x < frankfurt.x && frankfurt.x < tokyo.x)
  assert.ok(flatProject(-55, -70, FLAT_HOME, W, H).x < W / 2, "Tierra del Fuego is on the left half too")
  assert.ok(flatProject(0, 40, FLAT_HOME, W, H).x > flatProject(0, -40, FLAT_HOME, W, H).x)
  assert.ok(flatProject(40, 0, FLAT_HOME, W, H).y < flatProject(0, 0, FLAT_HOME, W, H).y, "north is up")
})

test("cropping the poles makes the map bigger than a full 180-degree-tall world at the same width", () => {
  assert.ok(flatScale(1200, 480, 1) * 360 > 1100)
  assert.equal(flatScale(1000, 500, 2), flatScale(1000, 500, 1) * 2)
})

test("zoom 1 locks the camera in the middle; zooming in allows panning but never past the map edge", () => {
  assert.deepEqual(clampCamera({ lon: 90, lat: 40, zoom: 1 }, W, H), FLAT_HOME)
  const z2 = clampCamera({ lon: 500, lat: 500, zoom: 2 }, W, H)
  const s = flatScale(W, H, 2)
  near(z2.lon, 180 - W / 2 / s)
  near(z2.lat, WORLD_LAT_TOP - H / 2 / s)
  const edge = flatProject(0, 180, z2, W, H).x
  near(edge, W, 1e-6)
  assert.equal(clampCamera({ lon: 0, lat: 0, zoom: 99 }, W, H).zoom, FLAT_ZOOM_MAX)
  assert.equal(clampZoom(0.2), 1)
  assert.equal(clampZoom(Number.NaN), 1)
  assert.deepEqual(clampCamera({ lon: Number.NaN, lat: Number.NaN, zoom: 3 }, W, H).lon, 0)
})

test("zoomAt keeps the point under the cursor fixed", () => {
  const start = clampCamera({ lon: 20, lat: 30, zoom: 2.5 }, W, H)
  const px = 800
  const py = 200
  const before = { lon: start.lon + (px - W / 2) / flatScale(W, H, start.zoom), lat: start.lat - (py - H / 2) / flatScale(W, H, start.zoom) }
  const next = zoomAt(start, 1.5, px, py, W, H)
  assert.ok(next.zoom > start.zoom)
  const after = flatProject(before.lat, before.lon, next, W, H)
  near(after.x, px, 1e-6)
  near(after.y, py, 1e-6)
})

test("zoomAt out to 1 returns to the home view", () => {
  const out = zoomAt(clampCamera({ lon: 100, lat: 20, zoom: 3 }, W, H), 0.01, 300, 100, W, H)
  assert.deepEqual(out, FLAT_HOME)
})

test("fitBounds frames a region with a margin and stays inside the world", () => {
  const ea = FLAT_REGIONS.find((r) => r.key === "ea")!
  const cam = fitBounds(ea, W, H)
  assert.ok(cam.zoom > 2)
  const a = flatProject(ea.lat[1], ea.lon[0], cam, W, H)
  const b = flatProject(ea.lat[0], ea.lon[1], cam, W, H)
  assert.ok(a.x > 0 && a.y > 0 && b.x < W && b.y < H, "the whole box is on screen")
  assert.deepEqual(fitBounds({ lon: [-180, 180], lat: [-58, 84] }, W, H), FLAT_HOME)
})

test("every region can be framed and the regions do not overlap each other", () => {
  for (const r of FLAT_REGIONS) {
    const cam = fitBounds(r, W, H)
    assert.ok(cam.zoom >= 1 && cam.zoom <= FLAT_ZOOM_MAX, r.key)
  }
  const inBox = (r: (typeof FLAT_REGIONS)[number], lat: number, lon: number) => lon >= r.lon[0] && lon <= r.lon[1] && lat >= r.lat[0] && lat <= r.lat[1]
  for (let lat = -50; lat <= 70; lat += 2) {
    for (let lon = -175; lon <= 175; lon += 2) {
      assert.ok(FLAT_REGIONS.filter((r) => inBox(r, lat, lon)).length <= 1, `${lat},${lon}`)
    }
  }
})

test("region buttons only show regions that contain a node and ignore the visitor marker", () => {
  const cities = [
    { lat: 47.6, lon: -122.3 }, // 西雅图
    { lat: 22.3, lon: 114.2 }, // 香港
    { lat: -37.8, lon: 145 }, // 墨尔本
    { lat: 50, lon: 8, visitor: true },
  ]
  assert.deepEqual(
    regionsWithCities(cities).map((r) => r.key),
    ["na", "ea", "oc"],
  )
  assert.deepEqual(regionsWithCities([]), [])
})

test("arcs end exactly on both city dots and never leave the world", () => {
  const seattle = { lat: 47.6, lon: -122.3 }
  const frankfurt = { lat: 50.1, lon: 8.7 }
  const arc = flatArc(seattle, frankfurt, FLAT_HOME, W, H)
  const a = flatProject(seattle.lat, seattle.lon, FLAT_HOME, W, H)
  const b = flatProject(frankfurt.lat, frankfurt.lon, FLAT_HOME, W, H)
  const pts = arc.points()
  near(pts[0].x, a.x)
  near(pts[0].y, a.y)
  near(pts[pts.length - 1].x, b.x)
  near(pts[pts.length - 1].y, b.y)
  assert.ok(pts.every((p) => p.x >= a.x - 1e-9 && p.x <= b.x + 1e-9), "Seattle to Frankfurt runs left to right across the Atlantic")
  assert.ok(arc.at(0.5).y < (a.y + b.y) / 2, "rises above the chord")
})

test("identical endpoints give a flat arc without NaN", () => {
  const arc = flatArc({ lat: 1, lon: 1 }, { lat: 1, lon: 1 }, FLAT_HOME, 800, 400)
  for (const p of arc.points()) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y))
})

test("the static layer key changes with the camera, size and theme but not with tiny jitter", () => {
  const key = flatLayerKey(FLAT_HOME, W, H, false, 100)
  assert.equal(flatLayerKey({ ...FLAT_HOME, lon: 0.001 }, W, H, false, 100), key)
  assert.notEqual(flatLayerKey({ ...FLAT_HOME, zoom: 1.5 }, W, H, false, 100), key)
  assert.notEqual(flatLayerKey(FLAT_HOME, W + 1, H, false, 100), key)
  assert.notEqual(flatLayerKey(FLAT_HOME, W, H, true, 100), key)
})

test("stored view defaults to globe and survives a broken storage", () => {
  const mem = new Map<string, string>()
  const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) }
  assert.equal(readStoredView(storage), "globe")
  writeStoredView("flat", storage)
  assert.equal(readStoredView(storage), "flat")
  const broken = {
    getItem: () => {
      throw new Error("blocked")
    },
    setItem: () => {
      throw new Error("blocked")
    },
  }
  assert.equal(readStoredView(broken), "globe")
  assert.doesNotThrow(() => writeStoredView("flat", broken))
  assert.equal(normalizeView("whatever"), "globe")
})

test("label priority ignores live speed so neighbouring cities do not swap places", () => {
  const sydney = { name: "悉尼", nodes: ["a"], hasData: true }
  const melbourne = { name: "墨尔本", nodes: ["b"], hasData: true }
  const before = stablePriority(sydney) > stablePriority(melbourne)
  for (let i = 0; i < 20; i++) {
    Object.assign(sydney, { down: i * 1e6, up: 0 })
    Object.assign(melbourne, { down: (20 - i) * 1e6, up: 0 })
    assert.equal(stablePriority(sydney) > stablePriority(melbourne), before)
  }
  assert.notEqual(stablePriority(sydney), stablePriority(melbourne))
})
