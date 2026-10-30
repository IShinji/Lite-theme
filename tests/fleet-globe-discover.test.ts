import assert from "node:assert/strict"
import test from "node:test"

import { type NodeInfo } from "../src/lib/fleet-globe-data.ts"
import nodesFixture from "./fixtures/fleet-nodes.json" with { type: "json" }

const fleetNodes: NodeInfo[] = nodesFixture
import { discoverNodes } from "../src/lib/fleet-globe-discover.ts"

const known: NodeInfo[] = [{ id: "JP-Tokyo-ORACLE-VPSNAT", city: "东京", lat: 35.68, lon: 139.69 }]

test("a Lite node that is not in the catalog shows up, placed by the city in its unified name", () => {
  const out = discoverNodes([{ name: "VN-HoChiMinhCity-FPT-VPSNAT", country_code: "VN" }], known)
  assert.equal(out.length, 1)
  const n = out[0]
  assert.equal(n.id, "VN-HoChiMinhCity-FPT-VPSNAT")
  assert.equal(n.city, "胡志明市")
  assert.ok(Math.abs(n.lat - 10.82) < 0.5 && Math.abs(n.lon - 106.63) < 0.5)
})

test("nodes already in the catalog are not added twice", () => {
  assert.deepEqual(discoverNodes([{ name: "JP-Tokyo-ORACLE-VPSNAT", country_code: "JP" }], known), [])
})

test("an unknown city falls back to the country centre from the node's own country code", () => {
  const out = discoverNodes([{ name: "DE-Nowhereville-ACME-SELLER", country_code: "de" }], known)
  assert.equal(out.length, 1)
  assert.equal(out[0].city, "DE")
  assert.ok(Number.isFinite(out[0].lat) && Number.isFinite(out[0].lon))
})

test("without a country code the region in the name is used; a name that gives nothing is dropped", () => {
  assert.equal(discoverNodes([{ name: "SG-Mystery-ACME-SELLER" }], known).length, 1)
  assert.deepEqual(discoverNodes([{ name: "my-random-box" }], known), [])
  assert.deepEqual(discoverNodes([{ name: "ZZ-Atlantis-ACME-SELLER", country_code: "ZZ" }], known), [])
})

test("Hong Kong names have no city part and still resolve", () => {
  const out = discoverNodes([{ name: "HK-NEWVENDOR-SELLER", country_code: "HK" }], known)
  assert.equal(out.length, 1)
})

test("a repeated name yields one node; the order of the input does not matter", () => {
  const s = [{ name: "VN-HoChiMinhCity-FPT-VPSNAT" }, { name: "VN-HoChiMinhCity-FPT-VPSNAT" }]
  assert.equal(discoverNodes(s, known).length, 1)
  assert.equal(discoverNodes([...s].reverse(), known).length, 1)
})

test("discovered nodes carry no address or token and the catalog itself is untouched", () => {
  const out = discoverNodes([{ name: "VN-HoChiMinhCity-FPT-VPSNAT", country_code: "VN" }], fleetNodes)
  assert.ok(!/\d+\.\d+\.\d+\.\d+/.test(JSON.stringify(out)))
  assert.equal(fleetNodes.length, 18)
})

import { displayCity, parseNodes, resolveCatalog } from "../src/lib/fleet-globe-discover.ts"
import { fetchHelper, fetchTopology, fetchTopologyDoc } from "../src/lib/fleet-globe-topology.ts"

test("parseNodes reads the published nodes and drops anything malformed", () => {
  const doc = {
    v: 1,
    links: [],
    nodes: [
      { id: "VN-HoChiMinhCity-FPT-VPSNAT", city: "Ho Chi Minh City", lat: 10.82, lon: 106.63 },
      { id: "VN-HoChiMinhCity-FPT-VPSNAT", city: "dup", lat: 1, lon: 1 },
      { id: "BAD-lat", city: "x", lat: 91, lon: 0 },
      { id: "BAD-lon", city: "x", lat: 0, lon: 181 },
      { id: "BAD-nan", city: "x", lat: "10", lon: 0 },
      { id: "has space", city: "x", lat: 0, lon: 0 },
      { id: "", city: "x", lat: 0, lon: 0 },
      { id: "no-city", city: "", lat: 0, lon: 0 },
      null,
      5,
    ],
  }
  const out = parseNodes(doc)
  assert.equal(out.length, 1)
  assert.equal(out[0].id, "VN-HoChiMinhCity-FPT-VPSNAT")
  assert.deepEqual(parseNodes(JSON.stringify(doc)).map((n) => n.id), ["VN-HoChiMinhCity-FPT-VPSNAT"])
  assert.deepEqual(parseNodes({ v: 1, links: [] }), [])
  assert.deepEqual(parseNodes("not json"), [])
  assert.deepEqual(parseNodes(null), [])
})

test("parseNodes caps the list so a bad file cannot flood the globe", () => {
  const nodes = Array.from({ length: 500 }, (_, i) => ({ id: `US-City${i}-A-B`, city: "c", lat: 1, lon: 1 }))
  assert.equal(parseNodes({ nodes }).length, 200)
})

test("display names are unified: city table first, Hong Kong by region, otherwise what was published", () => {
  assert.equal(displayCity("VN-HoChiMinhCity-FPT-VPSNAT", "Ho Chi Minh City"), "胡志明市")
  assert.equal(displayCity("HK-NEWVENDOR-SELLER", "Hong Kong"), "香港")
  assert.equal(displayCity("DE-Nowhereville-A-B", "Nowhereville"), "Nowhereville")
  assert.equal(displayCity("m1-physical", "西雅图"), "西雅图")
})

test("resolveCatalog: published coordinates win, then the table, then the country centre", () => {
  const published: NodeInfo[] = [
    { id: "VN-HoChiMinhCity-FPT-VPSNAT", city: "Ho Chi Minh City", lat: 10.9, lon: 106.7 },
    { id: "m1-physical", city: "西雅图", lat: 47.61, lon: -122.33 },
  ]
  const servers = [
    { name: "VN-HoChiMinhCity-FPT-VPSNAT", country_code: "VN" }, // 已发布：用发布的坐标，不被表覆盖
    { name: "SG-Singapore-ACME-SELLER", country_code: "SG" }, // 没发布：城市表
    { name: "DE-Nowhereville-ACME-SELLER", country_code: "DE" }, // 没发布、表里没有：国家中心
  ]
  const out = resolveCatalog(published, servers)
  const by = new Map(out.map((n) => [n.id, n]))
  assert.equal(by.size, 4)
  assert.equal(by.get("VN-HoChiMinhCity-FPT-VPSNAT")?.lat, 10.9)
  assert.equal(by.get("VN-HoChiMinhCity-FPT-VPSNAT")?.city, "胡志明市")
  assert.equal(by.get("SG-Singapore-ACME-SELLER")?.city, "新加坡")
  assert.equal(by.get("DE-Nowhereville-ACME-SELLER")?.city, "DE")
  assert.equal(by.get("m1-physical")?.city, "西雅图")
})

test("with nothing published and no Lite nodes, there are simply no points", () => {
  assert.deepEqual(resolveCatalog([], []), [])
})

const doc = { v: 1, updated: "2026-10-30T20:00:00Z", links: [{ from: "A-B-C-D", to: "E-F-G-H", kind: "exit", state: "active" }], nodes: [{ id: "VN-HoChiMinhCity-FPT-VPSNAT", city: "Ho Chi Minh City", lat: 10.82, lon: 106.63 }] }
const okFetch = (async () => ({ ok: true, json: async () => doc })) as unknown as typeof fetch

test("the topology fetch brings the published nodes along; the old links-only call still works", async () => {
  const full = await fetchTopologyDoc("/_globe/x.json", okFetch, 1000, "https://example.org")
  assert.equal(full?.links.length, 1)
  assert.equal(full?.nodes.length, 1)
  assert.equal((await fetchTopology("/_globe/x.json", okFetch, 1000, "https://example.org"))?.length, 1)
  const bad = (async () => ({ ok: false })) as unknown as typeof fetch
  assert.equal(await fetchTopologyDoc("/_globe/x.json", bad, 1000, "https://example.org"), null)
})

test("an old published file without nodes still loads, with an empty node list", async () => {
  const old = (async () => ({ ok: true, json: async () => ({ v: 1, links: doc.links }) })) as unknown as typeof fetch
  assert.deepEqual((await fetchTopologyDoc("/_globe/x.json", old, 1000, "https://example.org"))?.nodes, [])
})

test("the local helper result carries nodes too", async () => {
  const r = await fetchHelper("http://127.0.0.1:5174", okFetch, 1000)
  assert.ok(r.ok && r.nodes.length === 1 && r.links.length === 1)
})
