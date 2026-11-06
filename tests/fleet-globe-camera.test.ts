import assert from "node:assert/strict"
import test from "node:test"

import { FLAT_REGIONS } from "../src/lib/fleet-flatmap.ts"
import {
  GLOBE_ZOOM_MAX,
  GLOBE_ZOOM_MIN,
  clampGlobeLat,
  clampGlobeZoom,
  decoAlpha,
  globeFitCamera,
  globeVisibleWindow,
  globeRadius,
  lerpLon,
  normLon,
  orthoInverse,
  orthoProject,
} from "../src/lib/fleet-globe-camera.ts"

const W = 1200
const H = 555
const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`)

test("the camera centre projects to the middle of the disc, facing us", () => {
  const p = orthoProject(21, 168, 168, 21)
  near(p.u, 0)
  near(p.v, 0)
  near(p.z, 1)
})

test("north is up and east is right on the disc", () => {
  assert.ok(orthoProject(40, 120, 120, 20).v > 0)
  assert.ok(orthoProject(0, 130, 120, 20).u > 0)
  assert.ok(orthoProject(0, 110, 120, 20).u < 0)
})

test("the far side of the globe has z <= 0", () => {
  assert.ok(orthoProject(0, 120 + 180, 120, 0).z < 0)
})

test("inverse projection round-trips every visible point", () => {
  for (const [lat, lon] of [
    [35, 139],
    [-37, 145],
    [50, 8],
    [47, -122],
    [0, 0],
    [60, 100],
  ]) {
    for (const cam of [
      { lon: 120, lat: 20 },
      { lon: 0, lat: 0 },
      { lon: -100, lat: 45 },
    ]) {
      const p = orthoProject(lat, lon, cam.lon, cam.lat)
      if (p.z <= 0.02) continue
      const back = orthoInverse(p.u, p.v, cam.lon, cam.lat)
      assert.ok(back, `${lat},${lon} visible`)
      near(back.lat, lat, 1e-6)
      near(normLon(back.lon - lon), 0, 1e-6)
    }
  }
})

test("points outside the disc have no inverse (double-click on empty space does nothing)", () => {
  assert.equal(orthoInverse(1.1, 0, 0, 0), null)
  assert.equal(orthoInverse(0.8, 0.8, 0, 0), null)
  assert.equal(orthoInverse(Number.NaN, 0, 0, 0), null)
})

test("longitude helpers take the short way round", () => {
  assert.equal(normLon(190), -170)
  assert.equal(normLon(-190), 170)
  assert.equal(normLon(540), 180)
  near(lerpLon(170, -170, 0.5), 180)
  near(lerpLon(-170, 170, 0.5), -180)
  near(lerpLon(10, 50, 0.5), 30)
  near(lerpLon(400, 410, 0.5), 405)
  near(lerpLon(350, 10, 1), 370)
})

test("zoom and latitude limits", () => {
  assert.equal(clampGlobeZoom(99), GLOBE_ZOOM_MAX)
  assert.equal(clampGlobeZoom(0.1), GLOBE_ZOOM_MIN)
  assert.equal(clampGlobeZoom(Number.NaN), 1)
  assert.equal(clampGlobeLat(90), 65)
  assert.equal(clampGlobeLat(-90), -65)
  assert.equal(clampGlobeLat(Number.NaN), 0)
  assert.ok(GLOBE_ZOOM_MAX >= 3, "zoom goes well past the old 1.4 limit")
})

test("regions: the camera turns to the region centre and the whole box ends up on screen", () => {
  for (const r of FLAT_REGIONS) {
    const cam = globeFitCamera(r, W, H)
    assert.ok(cam.zoom >= 1 && cam.zoom <= GLOBE_ZOOM_MAX, `${r.key} zoom ${cam.zoom}`)
    const radius = globeRadius(W, H, cam.zoom)
    for (const [lat, lon] of [
      [r.lat[0], r.lon[0]],
      [r.lat[0], r.lon[1]],
      [r.lat[1], r.lon[0]],
      [r.lat[1], r.lon[1]],
    ]) {
      const p = orthoProject(lat, lon, cam.lon, cam.lat)
      assert.ok(p.z > 0, `${r.key} corner is on the front side`)
      const x = W * 0.5 + p.u * radius
      const y = H * 0.49 - p.v * radius
      assert.ok(x > 0 && x < W && y > 0 && y < H, `${r.key} corner (${Math.round(x)}, ${Math.round(y)}) is on screen`)
    }
  }
})

test("East Asia zooms in far enough to pull Xi'an, Shiyan, Shenyang, Osaka and Tokyo apart", () => {
  const ea = FLAT_REGIONS.find((r) => r.key === "ea")!
  const cam = globeFitCamera(ea, W, H)
  assert.ok(cam.zoom > 2, `zoom ${cam.zoom}`)
  const radius = globeRadius(W, H, cam.zoom)
  const px = (lat: number, lon: number) => {
    const p = orthoProject(lat, lon, cam.lon, cam.lat)
    return { x: p.u * radius, y: -p.v * radius }
  }
  const xian = px(34.34, 108.94)
  const shiyan = px(32.65, 110.78)
  assert.ok(Math.hypot(xian.x - shiyan.x, xian.y - shiyan.y) > 20, "the closest pair is more than 20px apart")
})

test("a region too big for one hemisphere is not zoomed", () => {
  const cam = globeFitCamera({ lon: [-180, 180], lat: [-58, 84] }, W, H)
  assert.equal(cam.zoom, 1)
})

test("the decorative ring fades out once zoomed in", () => {
  assert.equal(decoAlpha(1), 1)
  assert.equal(decoAlpha(1.3), 1)
  assert.equal(decoAlpha(1.8), 0)
  assert.equal(decoAlpha(4), 0)
  assert.ok(decoAlpha(1.55) > 0 && decoAlpha(1.55) < 1)
})

test("the visible window always contains every point that can be seen on stage", () => {
  const cx = W * 0.5
  const cy = H * 0.49
  for (const cam of [
    { lon: 120, lat: 20, zoom: 1 },
    { lon: 120, lat: 20, zoom: 3 },
    { lon: -100, lat: 45, zoom: 2 },
    { lon: 10, lat: -40, zoom: 4 },
    { lon: 170, lat: 62, zoom: 2.5 },
  ]) {
    const radius = globeRadius(W, H, cam.zoom)
    const win = globeVisibleWindow(cam.lon, cam.lat, radius, cx, cy, W, H)
    for (let lat = -88; lat <= 88; lat += 2) {
      for (let lon = -180; lon < 180; lon += 2) {
        const p = orthoProject(lat, lon, cam.lon, cam.lat)
        if (p.z <= 0) continue
        const x = cx + p.u * radius
        const y = cy - p.v * radius
        if (x < 0 || x > W || y < 0 || y > H) continue
        assert.ok(lat >= win.latMin && lat <= win.latMax, `lat ${lat} in window for ${JSON.stringify(cam)}`)
        if (win.lonMax - win.lonMin < 360) {
          const rel = ((((lon - cam.lon + 180) % 360) + 360) % 360) - 180
          assert.ok(Math.abs(rel) <= (win.lonMax - win.lonMin) / 2 + 1e-9, `lon ${lon} in window for ${JSON.stringify(cam)}`)
        }
      }
    }
  }
})

test("the visible window is the whole sphere when it fits on stage and a small patch when zoomed in", () => {
  const cx = W * 0.5
  const cy = H * 0.49
  const whole = globeVisibleWindow(120, 20, globeRadius(W, H, 1), cx, cy, W, H)
  assert.ok(whole.lonMax - whole.lonMin >= 180 && whole.latMax - whole.latMin >= 160, "the visible hemisphere")
  const z25 = globeVisibleWindow(120, 20, globeRadius(W, H, 2.5), cx, cy, W, H)
  assert.ok(z25.latMax - z25.latMin < 90 && z25.lonMax - z25.lonMin < 230, `zoom 2.5 window is ${z25.lonMax - z25.lonMin} x ${z25.latMax - z25.latMin}`)
  const z4 = globeVisibleWindow(120, 20, globeRadius(W, H, 4), cx, cy, W, H)
  assert.ok(z4.lonMax - z4.lonMin < 120 && z4.latMax - z4.latMin < 60, `zoom 4 window is ${z4.lonMax - z4.lonMin} x ${z4.latMax - z4.latMin}`)
  const polar = globeVisibleWindow(0, 80, globeRadius(W, H, 3), cx, cy, W, H)
  assert.equal(polar.lonMax - polar.lonMin, 360, "a pole in view means all longitudes")
})
