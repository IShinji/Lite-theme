import assert from "node:assert/strict"
import test from "node:test"

import { fleetLinks, fleetNodes } from "../src/lib/fleet-globe-data.ts"
import {
  countryFromTimeZone,
  kindsPresent,
  parseTopology,
  pickTopology,
  resolveTopology,
  visitorArcs,
  compactTopology,
  fetchTopology,
} from "../src/lib/fleet-globe-topology.ts"

const A = "CN-Shiyan-CHINATELECOM-SADIDC"
const B = "JP-Tokyo-ORACLE-VPSNAT"

test("parses the v1 format and maps legacy words", () => {
  const v1 = parseTopology(JSON.stringify({ v: 1, links: [{ from: A, to: B, kind: "exit", state: "active" }], updated: "2026-10-29T00:00:00Z" }))
  assert.deepEqual(v1, [{ from: A, to: B, kind: "exit", state: "active" }])
  const legacy = parseTopology([{ from: A, to: B, kind: "proxy", state: "configured" }, { from: B, to: A, kind: "management", state: "unavailable" }, { from: A, to: B, kind: "relay", state: "verified" }])
  assert.deepEqual(legacy?.map((l) => [l.kind, l.state]), [["exit", "standby"], ["mgmt", "down"], ["relay", "active"]])
})

test("accepts compact keys and drops malformed entries", () => {
  const compact = parseTopology('{"v":1,"links":[{"f":"a","t":"b","k":"underlay","s":"active"},{"f":"a"},{"f":"a","t":"b","k":"nope","s":"active"},null,5]}')
  assert.deepEqual(compact, [{ from: "a", to: "b", kind: "underlay", state: "active" }])
  assert.equal(parseTopology("not json"), null)
  assert.equal(parseTopology(""), null)
  assert.equal(parseTopology({ v: 2 }), null)
  assert.deepEqual(parseTopology([{ from: "a", to: "b", kind: "exit" }]), [{ from: "a", to: "b", kind: "exit", state: "standby" }])
})

test("compact output round-trips", () => {
  const links = parseTopology(fleetLinks) ?? []
  assert.equal(links.length, 16)
  assert.deepEqual(parseTopology(compactTopology(links)), links)
})

test("builtin 16 links use the new vocabulary and resolve to catalog nodes", () => {
  assert.ok(fleetLinks.every((l) => ["exit", "underlay", "relay", "mgmt"].includes(l.kind) && ["active", "standby", "down"].includes(l.state)))
  const resolved = resolveTopology(fleetLinks, fleetNodes, [])
  assert.equal(resolved.links.length, 16)
})

test("endpoints resolve via catalog, then server country; unknown ones are dropped", () => {
  const r = resolveTopology(
    [{ from: A, to: "Lite-only", kind: "exit", state: "active" }, { from: A, to: "ghost", kind: "exit", state: "active" }, { from: A, to: "nocountry", kind: "mgmt", state: "standby" }],
    fleetNodes,
    [{ name: "Lite-only", country_code: "jp" }, { name: "nocountry", country_code: "" }],
  )
  assert.equal(r.links.length, 1)
  assert.equal(r.links[0].from, "十堰")
  assert.equal(r.extraNodes.length, 1)
  assert.equal(r.extraNodes[0].id, "Lite-only")
  assert.ok(Math.abs(r.extraNodes[0].lat - 36.2) < 1)
})

test("priority: remote topology, then GlobeLinks, then nothing", () => {
  const ok = (to: string) => [{ from: A, to, kind: "exit", state: "active" }]
  const pick = (remote: unknown, custom: unknown) => pickTopology(remote, custom, fleetNodes, [])
  assert.equal(pick(ok(B), ok("US-SanJose-ORACLE"))?.source, "remote")
  assert.equal(pick(null, ok("US-SanJose-ORACLE"))?.source, "custom")
  assert.equal(pick([{ from: "x", to: "y", kind: "exit" }], ok(B))?.source, "custom")
  assert.equal(pick(undefined, "garbage"), null)
  assert.equal(pick(undefined, ""), null)
  assert.equal(pick([], []), null)
})

test("legend kinds follow the data", () => {
  const links = parseTopology([{ from: A, to: B, kind: "mgmt" }, { from: B, to: A, kind: "exit" }, { from: A, to: B, kind: "exit" }]) ?? []
  assert.deepEqual(kindsPresent(links), ["exit", "mgmt"])
  assert.deepEqual(kindsPresent([]), [])
})

test("time zone maps to a country, unknown maps to nothing", () => {
  assert.equal(countryFromTimeZone("Asia/Shanghai"), "CN")
  assert.equal(countryFromTimeZone("America/Los_Angeles"), "US")
  assert.equal(countryFromTimeZone("Europe/London"), "GB")
  assert.equal(countryFromTimeZone("Mars/Base"), null)
  assert.equal(countryFromTimeZone(undefined), null)
})

test("visitor arcs go from the visitor to every city as standby exits", () => {
  const arcs = visitorArcs("CN", fleetNodes)
  assert.ok(arcs)
  assert.equal(arcs.visitor.id, "__visitor__")
  const cities = new Set(fleetNodes.map((n) => n.city))
  assert.equal(arcs.links.length, cities.size)
  assert.ok(arcs.links.every((l) => l.kind === "exit" && l.state === "standby" && l.from === "访客"))
  assert.equal(visitorArcs(null, fleetNodes), null)
  assert.equal(visitorArcs("ZZ", fleetNodes), null)
})

test("remote fetch is credential-free and falls back silently", async () => {
  const calls: Array<[string, RequestInit | undefined]> = []
  const good = async (url: string, init?: RequestInit) => {
    calls.push([url, init])
    return { ok: true, json: async () => ({ v: 1, links: [{ from: A, to: B, kind: "exit", state: "active" }] }) } as Response
  }
  const r = await fetchTopology("https://example.org/t.json", good as unknown as typeof fetch)
  assert.equal(r?.length, 1)
  assert.equal(calls[0][1]?.credentials, "omit")
  assert.equal(calls[0][1]?.headers, undefined)
  assert.equal(await fetchTopology("http://example.org/t.json", good as unknown as typeof fetch), null)
  assert.equal(await fetchTopology("", good as unknown as typeof fetch), null)
  const boom = async () => { throw new Error("net") }
  assert.equal(await fetchTopology("https://example.org/t.json", boom as unknown as typeof fetch), null)
  const bad = async () => ({ ok: true, json: async () => ({ nope: 1 }) }) as Response
  assert.equal(await fetchTopology("https://example.org/t.json", bad as unknown as typeof fetch), null)
  const notOk = async () => ({ ok: false, json: async () => ({}) }) as Response
  assert.equal(await fetchTopology("https://example.org/t.json", notOk as unknown as typeof fetch), null)
})
