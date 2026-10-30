import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { buildCities, buildLinks, fleetLinks, fleetNodes, matchMetrics, rate } from "../src/lib/fleet-globe-data.ts"

const manifest = JSON.parse(readFileSync(new URL("../Lite-theme.json", import.meta.url), "utf8"))
const settings = manifest.configuration.data as Array<{ key?: string; type: string; default?: unknown }>
const server = readFileSync(new URL("../src/pages/Server.tsx", import.meta.url), "utf8")
const component = readFileSync(new URL("../src/components/FleetGlobe.tsx", import.meta.url), "utf8")
const css = readFileSync(new URL("../src/components/fleet-globe.css", import.meta.url), "utf8")

test("catalog is complete and every link endpoint exists in it", () => {
  assert.equal(fleetNodes.length, 18)
  const ids = new Set(fleetNodes.map((n) => n.id))
  assert.equal(ids.size, fleetNodes.length)
  for (const n of fleetNodes) assert.ok(Number.isFinite(n.lat) && Number.isFinite(n.lon) && n.city)
  assert.equal(fleetLinks.length, 16)
  for (const l of fleetLinks) assert.ok(ids.has(l.from) && ids.has(l.to), `${l.from} -> ${l.to}`)
  assert.ok(buildLinks(fleetNodes, fleetLinks).every((l) => l.from && l.to))
})

test("catalog does not publish ledger notes, addresses or tokens", () => {
  const text = JSON.stringify(fleetNodes) + JSON.stringify(fleetLinks)
  assert.ok(!/"(note|role|title|location)"/.test(text))
  assert.ok(!/\d+\.\d+\.\d+\.\d+/.test(text))
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-/.test(text))
})

test("samples match by unified node name; unmatched nodes have no sample", () => {
  const metrics = matchMetrics(fleetNodes, [{ name: "CN-Shiyan-CHINATELECOM-SADIDC", online: true, net_in: 2048, net_out: 512  }, { name: "unknown", online: true, net_in: 1, net_out: 1  }])
  assert.equal(metrics["CN-Shiyan-CHINATELECOM-SADIDC"]?.net_in, 2048)
  assert.equal(metrics["m1-vm"], null)
  const cities = buildCities(fleetNodes, metrics)
  const shiyan = cities.find((c) => c.name === "十堰")
  assert.ok(shiyan?.hasData && shiyan.online === 1 && shiyan.down === 2048)
  const seattle = cities.find((c) => c.name === "西雅图")
  assert.ok(seattle && !seattle.hasData && seattle.nodes.length === 4)
})

test("offline samples count as data but add no speed", () => {
  const metrics = matchMetrics(fleetNodes, [{ name: "JP-Osaka-ORACLE-VITEBITS", online: false, net_in: 99, net_out: 99  }])
  const osaka = buildCities(fleetNodes, metrics).find((c) => c.name === "大阪")
  assert.ok(osaka?.hasData && osaka.online === 0 && osaka.down === 0)
})

test("formats speeds like the original", () => {
  assert.equal(rate(0), "0 B/s")
  assert.equal(rate(1536), "1.5 KB/s")
  assert.equal(rate(150 * 1024), "150 KB/s")
  assert.equal(rate(5 * 1024 * 1024), "5.0 MB/s")
  assert.equal(rate(null), "—")
})

test("globe styles are scoped under one root class and the switch defaults off", () => {
  const selectors = css.replace(/\{[^{}]*\}/g, "{}").split(/[{}]/).map((s) => s.trim()).filter((s) => s && !s.startsWith("@media"))
  for (const sel of selectors) for (const part of sel.split(",")) assert.ok(part.trim().startsWith(".fleet-globe-root"), part)
  const sw = settings.find((s) => s.key === "ShowHomeGlobe")
  assert.ok(sw && sw.type === "switch" && sw.default === false)
  assert.match(server, /readShowHomeGlobe\(\) \? \(/)
})

test("the globe block has no detail card and spans the full row", () => {
  assert.ok(!/detail-card|node-state|select-wrap|resource-row/.test(css))
  assert.ok(!/detail-card|详情/.test(component))
  assert.ok(!/network-layout\{[^}]*grid-template-columns/.test(css))
})
