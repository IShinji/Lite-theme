import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { normalizeHelperUrl } from "../src/lib/theme-config.ts"
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
  fetchHelper,
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
  // 同源相对路径：解析到当前页面的域名；协议相对（//host/…）和非 / 开头的相对写法一律拒绝
  let seen = ""
  const spy = (async (u: string) => { seen = u; return good(u) }) as unknown as typeof fetch
  const rel = await fetchTopology("/_globe/globe-x.json", spy, 8000, "https://lite.example.org")
  assert.ok(rel && rel.length > 0)
  assert.equal(seen, "https://lite.example.org/_globe/globe-x.json")
  assert.equal(await fetchTopology("//evil.example.net/t.json", good as unknown as typeof fetch, 8000, "https://lite.example.org"), null)
  assert.equal(await fetchTopology("t.json", good as unknown as typeof fetch, 8000, "https://lite.example.org"), null)
  const boom = async () => { throw new Error("net") }
  assert.equal(await fetchTopology("https://example.org/t.json", boom as unknown as typeof fetch), null)
  const bad = async () => ({ ok: true, json: async () => ({ nope: 1 }) }) as Response
  assert.equal(await fetchTopology("https://example.org/t.json", bad as unknown as typeof fetch), null)
  const notOk = async () => ({ ok: false, json: async () => ({}) }) as Response
  assert.equal(await fetchTopology("https://example.org/t.json", notOk as unknown as typeof fetch), null)
})

test("helper url: only loopback http or https, otherwise the default", () => {
  const d = "http://127.0.0.1:5174"
  assert.equal(normalizeHelperUrl(""), d)
  assert.equal(normalizeHelperUrl(undefined), d)
  assert.equal(normalizeHelperUrl("http://127.0.0.1:6000"), "http://127.0.0.1:6000")
  assert.equal(normalizeHelperUrl("http://localhost:6000/"), "http://localhost:6000")
  assert.equal(normalizeHelperUrl("https://helper.example.org"), "https://helper.example.org")
  assert.equal(normalizeHelperUrl("http://example.org:80"), d)
  assert.equal(normalizeHelperUrl("http://127.0.0.1"), d)
  assert.equal(normalizeHelperUrl("javascript:alert(1)"), d)
  assert.equal(normalizeHelperUrl("ftp://127.0.0.1:21"), d)
})

test("helper fetch: plain GET, no headers, classifies failures", async () => {
  const calls: Array<[string, RequestInit | undefined]> = []
  const body = { v: 1, links: [{ from: A, to: B, kind: "exit", state: "active" }], updated: "2026-10-29T12:00:00Z" }
  const ok = async (url: string, init?: RequestInit) => { calls.push([url, init]); return { ok: true, status: 200, json: async () => body } as Response }
  const r = await fetchHelper("http://127.0.0.1:5174", ok as unknown as typeof fetch)
  assert.ok(r.ok && r.links.length === 1 && r.updated === "2026-10-29T12:00:00Z")
  assert.equal(calls[0][0], "http://127.0.0.1:5174/topology.json")
  assert.equal(calls[0][1]?.method, "GET")
  assert.equal(calls[0][1]?.credentials, "omit")
  assert.equal(calls[0][1]?.cache, "no-store")
  assert.equal(calls[0][1]?.headers, undefined)
  const net = async () => { throw new TypeError("Failed to fetch") }
  assert.deepEqual(await fetchHelper("http://127.0.0.1:5174", net as unknown as typeof fetch), { ok: false, reason: "network" })
  const slow = async (_u: string, init?: RequestInit) => new Promise<Response>((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new DOMException("x", "AbortError"))))
  assert.deepEqual(await fetchHelper("http://127.0.0.1:5174", slow as unknown as typeof fetch, 20), { ok: false, reason: "timeout" })
  const bad = async () => ({ ok: true, status: 200, json: async () => ({ nope: 1 }) }) as Response
  assert.deepEqual(await fetchHelper("http://127.0.0.1:5174", bad as unknown as typeof fetch), { ok: false, reason: "format" })
  const notJson = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("x") } }) as unknown as Response
  assert.deepEqual(await fetchHelper("http://127.0.0.1:5174", notJson as unknown as typeof fetch), { ok: false, reason: "format" })
  const http500 = async () => ({ ok: false, status: 500, json: async () => ({}) }) as Response
  assert.deepEqual(await fetchHelper("http://127.0.0.1:5174", http500 as unknown as typeof fetch), { ok: false, reason: "network" })
})

test("button wiring: helper beats other sources, only on click, not while hidden", () => {
  const comp = readFileSync(new URL("../src/components/FleetGlobe.tsx", import.meta.url), "utf8")
  assert.match(comp, /获取最新/)
  assert.match(comp, /本机助手没响应：在终端运行 sh scripts\/topology-helper\.sh/)
  assert.match(comp, /pickTopology\(helper\.links,null,/)
  assert.match(comp, /document\.hidden/)
  const manifest = JSON.parse(readFileSync(new URL("../Lite-theme.json", import.meta.url), "utf8"))
  const f = manifest.configuration.data.find((x: { key?: string }) => x.key === "GlobeHelperUrl")
  assert.ok(f && f.type === "input" && f.default === "")
})

import { cityStates, dotAlpha, dotRadius, globePalette, ringState, rgba, staticLayerKey } from "../src/lib/fleet-globe-style.ts"

test("palette follows the theme and both palettes have all colors", () => {
  assert.equal(globePalette(true).dark, true)
  assert.equal(globePalette(false).dark, false)
  assert.notEqual(globePalette(true).sphere[0], globePalette(false).sphere[0])
  for (const p of [globePalette(true), globePalette(false)]) for (const v of Object.values(p)) assert.ok(v !== "" && v !== undefined)
})

test("land dots fade toward the limb", () => {
  assert.ok(dotAlpha(1) > dotAlpha(0.5) && dotAlpha(0.5) > dotAlpha(0))
  assert.ok(dotAlpha(0) > 0 && dotAlpha(1) <= 1)
  assert.ok(dotRadius(1) > dotRadius(0))
  assert.equal(dotAlpha(NaN), dotAlpha(0))
  assert.equal(dotAlpha(5), dotAlpha(1))
})

test("pulse rings expand and fade over time, the second ring is offset by half a period", () => {
  const a = ringState(0, 0), b = ringState(1300, 0)
  assert.ok(b.radius > a.radius && b.alpha < a.alpha)
  assert.ok(ringState(0, 1).radius > a.radius)
  assert.ok(Math.abs(ringState(2600, 0).radius - a.radius) < 1e-9)
  for (const t of [0, 500, 2599, 99999]) { const r = ringState(t, 1); assert.ok(r.alpha >= 0 && r.alpha <= 0.6 && r.radius >= 6 && r.radius <= 24) }
})

test("city state takes the strongest link state", () => {
  const m = cityStates([{ from: "a", to: "b", state: "down" }, { from: "a", to: "c", state: "standby" }, { from: "c", to: "b", state: "active" }])
  assert.equal(m.get("a"), "standby")
  assert.equal(m.get("b"), "active")
  assert.equal(m.get("c"), "active")
  assert.equal(m.get("x"), undefined)
  assert.equal(cityStates([{ from: "a", to: "b", state: "down" }]).get("a"), "down")
})

test("rgba helper and static layer cache key", () => {
  assert.equal(rgba("#9cefd0", 0.5), "rgba(156,239,208,0.5)")
  assert.equal(rgba("bad", 1), "rgba(255,255,255,1)")
  const cam = { lon: 100, lat: 20, zoom: 1 }
  const k = staticLayerKey(cam, 800, 600, false, 10)
  assert.equal(staticLayerKey({ ...cam, lon: 100.03 }, 800, 600, false, 10), k)
  assert.notEqual(staticLayerKey({ ...cam, lon: 100.2 }, 800, 600, false, 10), k)
  assert.notEqual(staticLayerKey(cam, 800, 600, true, 10), k)
  assert.notEqual(staticLayerKey(cam, 800, 600, false, 11), k)
})

import { densifyLand, dotHash, initialView, layoutLabels, rateCompact } from "../src/lib/fleet-globe-layout.ts"

test("compact speeds", () => {
  assert.equal(rateCompact(0), "0")
  assert.equal(rateCompact(512), "512B")
  assert.equal(rateCompact(1536), "1.5K")
  assert.equal(rateCompact(150 * 1024), "150K")
  assert.equal(rateCompact(5 * 1024 * 1024), "5.0M")
  assert.equal(rateCompact(null), "0")
})

test("initial view: centers on the densest cluster (not the global mean), circular longitude, pitch within range, ignores visitor", () => {
  const v = initialView([{ lat: 35, lon: 170, nodes: [1] }, { lat: 35, lon: -170, nodes: [1] }])
  assert.ok(Math.abs(Math.abs(v.lon) - 180) < 1e-6)
  // 亚洲 3 个、北美 1 个：落在亚洲，不是两者平均（太平洋）
  const heavy = initialView([{ lat: 30, lon: 100, nodes: [1, 2, 3] }, { lat: 30, lon: -120, nodes: [1] }])
  assert.ok(Math.abs(heavy.lon - 100) < 1e-6, `lon=${heavy.lon}`)
  // 同一片里的城市按节点数加权取平均
  const mix = initialView([{ lat: 35, lon: 140, nodes: [1, 2] }, { lat: 22, lon: 114, nodes: [1] }, { lat: 30, lon: -120, nodes: [1] }])
  assert.ok(mix.lon > 114 && mix.lon < 140)
  assert.ok(v.lat >= 12 && v.lat <= 28)
  assert.deepEqual(initialView([]), { lon: 120, lat: 20 })
  assert.equal(initialView([{ lat: 0, lon: 50, nodes: [], visitor: true }]).lon, 120)
})

test("labels: overlapping ones are pushed away from the globe center, stuck ones shrink then hide, pinned stay", () => {
  const mk = (key: string, x: number, y: number, priority: number, pinned = false) => ({ key, x, y, w: 80, h: 26, smallW: 40, smallH: 15, priority, pinned })
  const overlap = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  const out = layoutLabels([mk("a", 400, 300, 1), mk("b", 410, 305, 2)], { x: 300, y: 300 }, { w: 900, h: 700 })
  assert.ok(!overlap(out[0], out[1]) || out.some((o) => o.mode !== "full"))
  assert.ok(out[0].x !== 400 || out[0].y !== 300)
  assert.equal(out[1].x, 410)
  const crowd = Array.from({ length: 12 }, (_, i) => mk(`c${i}`, 400, 300, i))
  const res = layoutLabels(crowd, { x: 300, y: 300 }, { w: 500, h: 400 })
  const visible = res.filter((r) => r.mode !== "hidden")
  for (let i = 0; i < visible.length; i++) for (let j = i + 1; j < visible.length; j++) assert.ok(!overlap(visible[i], visible[j]))
  assert.ok(res.some((r) => r.mode === "name" || r.mode === "hidden"))
  const pinned = layoutLabels([mk("p", 400, 300, 0, true), mk("q", 400, 300, 9)], { x: 300, y: 300 }, { w: 900, h: 700 })
  assert.equal(pinned[0].mode, "full")
  assert.deepEqual([pinned[0].x, pinned[0].y], [400, 300])
  for (const r of res) { assert.ok(r.x >= 4 && r.y >= 4 && r.x + r.w <= 496 && r.y + r.h <= 396) }
})

test("land densify adds interior points only and keeps the originals", () => {
  const sq = [[0, 0], [2.4, 0], [0, 2.4], [2.4, 2.4]]
  const d = densifyLand(sq)
  assert.ok(d.length > sq.length && d.length <= sq.length * 4)
  assert.ok(sq.every((p) => d.some((q) => q[0] === p[0] && q[1] === p[1])))
  assert.ok(d.some((q) => q[0] === 1.2 && q[1] === 1.2))
  const lone = densifyLand([[0, 0]])
  assert.deepEqual(lone, [[0, 0]])
  const h = dotHash(10, 20)
  assert.ok(h >= 0 && h < 1 && h === dotHash(10, 20))
})

import { kindColors } from "../src/lib/fleet-globe-style.ts"

test("light palette is a translucent glass sphere with darker, saturated link colors", () => {
  const l = globePalette(false), d = globePalette(true)
  assert.equal(l.additive, false)
  assert.equal(d.additive, true)
  assert.ok(l.sphere[0].toLowerCase() > "#e0e0e0")
  assert.ok(d.sphere[0].toLowerCase() < "#404040")
  assert.deepEqual(Object.keys(kindColors(false)).sort(), ["exit", "mgmt", "relay", "underlay"])
  assert.equal(kindColors(true).exit, "#9cefd0")
  assert.notEqual(kindColors(false).exit, kindColors(true).exit)
  assert.notEqual(l.ring, d.ring)
})
