import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { HOME_HEALTH_DOT_LIMIT, healthStatusDots } from "../src/lib/health-dots.ts"

function fleet(online: number, offline: number) {
  return [
    ...Array.from({ length: online }, () => ({ online: true })),
    ...Array.from({ length: offline }, () => ({ online: false })),
  ]
}

test("health dots keep one pill per server until the row is full", () => {
  assert.equal(HOME_HEALTH_DOT_LIMIT, 24)
  assert.deepEqual(healthStatusDots([]), [])
  assert.deepEqual(healthStatusDots([{ online: true }, { online: false }, { online: true }]), [true, false, true])
  assert.equal(healthStatusDots(fleet(19, 5)).length, 24)
  assert.equal(healthStatusDots(fleet(24, 0)).length, 24)
})

test("health dots compress large fleets to a fixed row and keep offline visible", () => {
  const hundred = healthStatusDots(fleet(80, 20))
  assert.equal(hundred.length, 24)
  assert.equal(hundred.filter(Boolean).length, 19)
  assert.equal(hundred.filter((online) => !online).length, 5)

  const mostlyOnline = healthStatusDots(fleet(99, 1))
  assert.equal(mostlyOnline.filter(Boolean).length, 23)
  assert.equal(mostlyOnline.filter((online) => !online).length, 1)

  const mostlyOffline = healthStatusDots(fleet(1, 99))
  assert.equal(mostlyOffline.filter(Boolean).length, 1)
  assert.equal(mostlyOffline.filter((online) => !online).length, 23)

  assert.deepEqual(healthStatusDots(fleet(100, 0)), Array(24).fill(true))
  assert.deepEqual(healthStatusDots(fleet(0, 60)), Array(24).fill(false))
})

test("homepage overview no longer lists a health-dot strip", () => {
  const overview = readFileSync(new URL("../src/components/ServerOverview.tsx", import.meta.url), "utf8")
  assert.doesNotMatch(overview, /healthStatusDots/)
  assert.doesNotMatch(overview, /slice\(0, 32\)/)
})

test("homepage overview says all offline when none are online", () => {
  const overview = readFileSync(new URL("../src/components/ServerOverview.tsx", import.meta.url), "utf8")
  assert.match(overview, /online === 0/)
  assert.match(overview, /serverOverview\.allOffline/)
  assert.match(overview, /serverOverview\.someOffline/)
})
