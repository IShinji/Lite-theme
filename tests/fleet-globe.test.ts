import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { globeMarkers, globeVector, locateNode, MAX_GLOBE_MARKERS } from "../src/lib/globe-geo.ts"

const manifest = JSON.parse(readFileSync(new URL("../Lite-theme.json", import.meta.url), "utf8"))
const settings = manifest.configuration.data as Array<{ key?: string; type: string; default?: unknown }>
const server = readFileSync(new URL("../src/pages/Server.tsx", import.meta.url), "utf8")
const globe = readFileSync(new URL("../src/components/FleetGlobe.tsx", import.meta.url), "utf8")
const config = readFileSync(new URL("../src/lib/theme-config.ts", import.meta.url), "utf8")

test("locates a node by city in its name before falling back to the country", () => {
  const tokyo = locateNode({ country_code: "JP", name: "JP-Tokyo-ORACLE" })
  const osaka = locateNode({ country_code: "JP", name: "JP-Osaka-VPS" })
  const country = locateNode({ country_code: "jp", name: "plain" })
  assert.ok(tokyo && osaka && country)
  assert.ok(Math.abs(tokyo.lat - 35.7) < 1 && Math.abs(tokyo.lon - 139.7) < 1)
  assert.ok(Math.abs(osaka.lon - 135.5) < 1)
  assert.ok(country.lat > 30 && country.lat < 40)
})

test("hong kong and singapore resolve from the country code alone", () => {
  assert.ok(locateNode({ country_code: "HK", name: "x" }))
  assert.ok(locateNode({ country_code: "SG", name: "x" }))
})

test("nodes that cannot be located are not drawn", () => {
  assert.equal(locateNode({ country_code: "", name: "nothing" }), null)
  assert.equal(locateNode({ country_code: "ZZ", name: "nothing" }), null)
  assert.deepEqual(globeMarkers([{ country_code: "", name: "a", online: true }]), [])
})

test("markers merge nodes at one place and count online ones", () => {
  const markers = globeMarkers([
    { country_code: "JP", name: "JP-Tokyo-A", online: true },
    { country_code: "JP", name: "JP-Tokyo-B", online: false },
    { country_code: "US", name: "US-Seattle-A", online: true },
  ])
  assert.equal(markers.length, 2)
  const tokyo = markers.find((m) => m.total === 2)
  assert.equal(tokyo?.online, 1)
})

test("marker count is capped", () => {
  const codes = ["US", "JP", "DE", "FR", "GB", "SG", "HK", "AU", "BR", "IN", "CA", "KR", "NL", "SE", "IT", "ES", "ZA", "MX", "AR", "RU"]
  const many = Array.from({ length: 400 }, (_, i) => ({ country_code: codes[i % codes.length], name: `n${i}`, online: true }))
  assert.ok(globeMarkers(many).length <= MAX_GLOBE_MARKERS)
  assert.ok(MAX_GLOBE_MARKERS <= 60)
})

test("unit vectors are normalised", () => {
  const v = globeVector(35, 139)
  assert.ok(Math.abs(Math.hypot(v[0], v[1], v[2]) - 1) < 1e-9)
})

test("the home globe switch is off by default and read from the window", () => {
  const setting = settings.find((item) => item.key === "ShowHomeGlobe")
  assert.equal(setting?.type, "switch")
  assert.equal(setting?.default, false)
  assert.match(config, /readShowHomeGlobe/)
  assert.match(config, /"ShowHomeGlobe", false/)
  assert.match(server, /readShowHomeGlobe\(\)/)
  assert.match(server, /FleetGlobe/)
})

test("the globe pauses when hidden, offscreen or reduced motion, and has no network access", () => {
  assert.match(globe, /visibilitychange/)
  assert.match(globe, /IntersectionObserver/)
  assert.match(globe, /prefers-reduced-motion/)
  assert.match(globe, /touchAction: "pan-y"/)
  assert.match(globe, /Math\.min\(window\.devicePixelRatio \|\| 1, 2\)/)
  assert.doesNotMatch(globe, /fetch\(|https?:\/\//)
})
