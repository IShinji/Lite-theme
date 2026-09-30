import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  isLongTermExpiry,
  mergeThemeBillingDataMod,
  remainingExpiryDaysCeil,
  resolveThemeBillingEndDate,
  THEME_LONG_TERM_END_DATE,
} from "../src/lib/theme-billing.ts"

test("theme remaining days stay in days and ceil sub-day remainders", () => {
  const expire = "2026-10-01T12:00:00.000Z"
  const now = Date.parse("2026-10-01T00:00:00.000Z")
  assert.equal(remainingExpiryDaysCeil(expire, now), 1)
  assert.equal(remainingExpiryDaysCeil(expire, Date.parse("2026-10-01T12:00:00.000Z")), 0)
  assert.equal(remainingExpiryDaysCeil(expire, Date.parse("2026-10-01T12:00:00.001Z")), 0)
  const utils = readFileSync(new URL("../src/lib/utils.ts", import.meta.url), "utf8")
  assert.match(utils, /mergeThemeBillingDataMod\(existing\?\.billingDataMod/)
  assert.doesNotMatch(utils, /endDate: endDate \|\| existing\?\.billingDataMod\?\.endDate/)
  assert.doesNotMatch(utils, /getNextCycleTime\(endTime/)
  assert.doesNotMatch(utils, /diff\(dayjs\(\), "year"/)
})

test("theme billing endDate uses server expiry and falls back to the old remark", () => {
  assert.equal(
    resolveThemeBillingEndDate("2026-11-01T00:00:00.000Z", "2025-01-01T00:00:00.000Z"),
    "2026-11-01T00:00:00.000Z",
  )
  assert.equal(
    resolveThemeBillingEndDate("", "2025-01-01T00:00:00.000Z"),
    "2025-01-01T00:00:00.000Z",
  )
  assert.equal(resolveThemeBillingEndDate("", ""), null)
  assert.equal(resolveThemeBillingEndDate(null, null), null)
  assert.equal(resolveThemeBillingEndDate(undefined, "2025-02-01T00:00:00.000Z"), "2025-02-01T00:00:00.000Z")
  assert.equal(
    resolveThemeBillingEndDate("2226-01-01T00:00:00.000Z", "2025-01-01T00:00:00.000Z"),
    THEME_LONG_TERM_END_DATE,
  )
  const info = readFileSync(new URL("../src/components/billingInfo.tsx", import.meta.url), "utf8")
  assert.match(info, /isLongTermExpiry\(billingData\.endDate\)/)
})

test("theme long-term expiry uses year bounds, not a 100-year window", () => {
  assert.equal(isLongTermExpiry("0001-01-01T00:00:00.000Z"), true)
  assert.equal(isLongTermExpiry("0001-06-15T12:00:00.000Z"), true)
  assert.equal(isLongTermExpiry("2150-01-01T00:00:00.000Z"), false)
  assert.equal(isLongTermExpiry("2226-01-01T00:00:00.000Z"), true)
  assert.equal(isLongTermExpiry(null), true)
  assert.equal(remainingExpiryDaysCeil("0001-01-01T00:00:00.000Z"), null)
  assert.equal(remainingExpiryDaysCeil("2226-01-01T00:00:00.000Z"), null)
  assert.equal(remainingExpiryDaysCeil(THEME_LONG_TERM_END_DATE), null)
  const finite = remainingExpiryDaysCeil("2150-01-01T00:00:00.000Z", Date.parse("2149-12-31T00:00:00.000Z"))
  assert.equal(finite, 1)
})

test("theme public note keeps remark autoRenewal ahead of the server flag", () => {
  const kept = mergeThemeBillingDataMod(
    {
      startDate: "2025-01-01T00:00:00.000Z",
      endDate: "2025-02-01T00:00:00.000Z",
      autoRenewal: "1",
      cycle: "月",
      amount: "9",
    },
    {
      expiredAt: "2026-11-01T00:00:00.000Z",
      startDate: "2026-10-02T00:00:00.000Z",
      autoRenewal: "0",
      cycle: "月",
      amount: "10",
      currency: "USD",
    },
  )
  assert.equal(kept?.autoRenewal, "1")
  assert.equal(kept?.endDate, "2026-11-01T00:00:00.000Z")

  const fromServer = mergeThemeBillingDataMod(undefined, {
    expiredAt: "2026-11-01T00:00:00.000Z",
    autoRenewal: "1",
    cycle: "月",
    amount: "10",
    currency: "USD",
  })
  assert.equal(fromServer?.autoRenewal, "1")

  const remarkEnd = mergeThemeBillingDataMod(
    { endDate: "2025-02-01T00:00:00.000Z", autoRenewal: "1", cycle: "月", amount: "9" },
    { expiredAt: "", autoRenewal: "0", cycle: "月", amount: "", currency: "" },
  )
  assert.equal(remarkEnd?.endDate, "2025-02-01T00:00:00.000Z")
  assert.equal(remarkEnd?.autoRenewal, "1")

  const empty = mergeThemeBillingDataMod(undefined, {
    expiredAt: "",
    autoRenewal: "0",
    cycle: "月",
    amount: "10",
    currency: "USD",
  })
  assert.equal(empty, null)
})
