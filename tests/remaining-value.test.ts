import assert from "node:assert/strict"
import test from "node:test"

import { readShowServerRemainingValue } from "../src/lib/theme-config.ts"
import { formatRemainingValue } from "../src/lib/remaining-value.ts"

test("formats remaining value with currency and two decimals", () => {
  assert.equal(formatRemainingValue("12.340000", "USD"), "$12.34")
  assert.equal(formatRemainingValue("0.000000", "CNY"), "¥0.00")
  assert.equal(formatRemainingValue("8", "EUR"), "€8.00")
  assert.equal(formatRemainingValue("", "USD"), "")
  assert.equal(formatRemainingValue(undefined, "USD"), "")
  assert.equal(formatRemainingValue("not-a-number", "USD"), "")
})

test("remaining value switch defaults on and can be turned off", () => {
  assert.equal(readShowServerRemainingValue(), true)
  const previous = globalThis.window
  const fake = { ShowServerRemainingValue: false } as Window & typeof globalThis
  Object.defineProperty(globalThis, "window", { configurable: true, value: fake, writable: true })
  try {
    assert.equal(readShowServerRemainingValue(), false)
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: previous, writable: true })
  }
})
