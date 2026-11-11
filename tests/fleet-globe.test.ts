import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { buildCities, dropHiddenCities, hiddenOffline, trackOfflineSince, flagOfId, fleetLinks, matchMetrics, rate, type NodeInfo } from "../src/lib/fleet-globe-data.ts"
import nodesFixture from "./fixtures/fleet-nodes.json" with { type: "json" }

// 生产代码不再带写死的节点目录（坐标由发布的拓扑 JSON 里的 nodes 提供）；这里用夹具复现原来的 18 台
const fleetNodes: NodeInfo[] = nodesFixture

const manifest = JSON.parse(readFileSync(new URL("../Lite-theme.json", import.meta.url), "utf8"))
const settings = manifest.configuration.data as Array<{ key?: string; type: string; default?: unknown }>
const server = readFileSync(new URL("../src/pages/Server.tsx", import.meta.url), "utf8")
const component = readFileSync(new URL("../src/components/FleetGlobe.tsx", import.meta.url), "utf8")
const globeView = readFileSync(new URL("../src/components/FleetGlobeView.tsx", import.meta.url), "utf8")
const css = readFileSync(new URL("../src/components/fleet-globe.css", import.meta.url), "utf8")

test("catalog is complete and every link endpoint exists in it", () => {
  assert.equal(fleetNodes.length, 18)
  const ids = new Set(fleetNodes.map((n) => n.id))
  assert.equal(ids.size, fleetNodes.length)
  for (const n of fleetNodes) assert.ok(Number.isFinite(n.lat) && Number.isFinite(n.lon) && n.city)
  assert.equal(fleetLinks.length, 16)
  for (const l of fleetLinks) assert.ok(ids.has(l.from) && ids.has(l.to), `${l.from} -> ${l.to}`)
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
  assert.ok(!/^\.fleet-globe-root\s*$/m.test(css), "dangling selector prefix")
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

test("down links draw dashed grey without pulses; active and standby keep the pulses", () => {
  assert.match(globeView, /if \(down\) \{\s*trace\(\)[^}]*setLineDash\(\[3, 5\]\)[^}]*continue\s*\}/)
  assert.match(globeView, /if \(playing\) \{\s*for \(const offset of \[0, 0\.49\]\)/)
  assert.match(globeView, /st === "active" && playing/)
})

test("topology settings are optional, empty by default, and fetched without credentials", () => {
  for (const key of ["GlobeLinks", "GlobeTopologyUrl"]) {
    const f = settings.find((s) => s.key === key)
    assert.ok(f && f.default === "", key)
  }
  const topo = readFileSync(new URL("../src/lib/fleet-globe-topology.ts", import.meta.url), "utf8")
  assert.match(topo, /credentials: "omit"/)
  assert.ok(!/headers/.test(topo))
  assert.match(component, /visibilitychange/)
  assert.match(component, /REFRESH_MS=60000/)
})

test("city labels get a flag from the unified-name country prefix", () => {
  assert.equal(flagOfId("HK-VPSQUAN-ULZIX"), "🇭🇰")
  assert.equal(flagOfId("CN-Shenyang-CHINAUNICOM-Xiaomi"), "🇨🇳")
  assert.equal(flagOfId("US-Seattle-HOSTPAPA-RACKNERD"), "🇺🇸")
  assert.equal(flagOfId("m1-physical"), "")
  const cities = buildCities(
    [{ id: "m1-physical", city: "X", lat: 0, lon: 0 }, { id: "JP-Tokyo-ORACLE-VPSNAT", city: "X", lat: 0, lon: 0 }],
    {},
  )
  assert.equal(cities[0].flag, "🇯🇵")
})

test("离线隐藏：连续离线满 10 秒才隐藏、恢复立刻显示、整城离线才去掉城市", () => {
  let since = trackOfflineSince(new Map(), new Set(["JP-Tokyo-A"]), 1000)
  assert.equal(hiddenOffline(since, 5000).size, 0, "未满 10 秒不隐藏")
  since = trackOfflineSince(since, new Set(["JP-Tokyo-A"]), 9000)
  assert.equal(since.get("JP-Tokyo-A"), 1000, "连续离线保留起点")
  assert.ok(hiddenOffline(since, 11000).has("JP-Tokyo-A"), "满 10 秒隐藏")
  since = trackOfflineSince(since, new Set(), 12000)
  assert.equal(hiddenOffline(since, 99000).size, 0, "恢复在线立刻显示")

  const city = (name: string, nodes: string[]) => ({ name, lat: 0, lon: 0, nodes, online: 0, down: 0, up: 0, hasData: true })
  const cities = [city("东京", ["a", "b"]), city("大阪", ["c"]), city("家", []), city("无采样", ["d"])]
  const out = dropHiddenCities(cities, new Set(["a", "c"]))
  assert.deepEqual(out.map((c) => c.name), ["东京", "家", "无采样"], "大阪全隐藏被去掉；无节点/未隐藏的保留")
  assert.deepEqual(out[0].nodes, ["b"], "同城还有在线的，节点数只算未隐藏的")
})
