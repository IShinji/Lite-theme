import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

const manifest = JSON.parse(readFileSync(new URL("../Lite-theme.json", import.meta.url), "utf8"))
const settings = manifest.configuration.data as Array<Record<string, unknown>>
const keys = settings.map((item) => item.key).filter(Boolean)
const header = readFileSync(new URL("../src/components/Header.tsx", import.meta.url), "utf8")
const themeSwitcher = readFileSync(new URL("../src/components/ThemeSwitcher.tsx", import.meta.url), "utf8")
const serverCard = readFileSync(new URL("../src/components/ServerCard.tsx", import.meta.url), "utf8")
const detailOverview = readFileSync(new URL("../src/components/ServerDetailOverview.tsx", import.meta.url), "utf8")
const networkChart = readFileSync(new URL("../src/components/NetworkChart.tsx", import.meta.url), "utf8")
const utils = readFileSync(new URL("../src/lib/utils.ts", import.meta.url), "utf8")

test("publishes the independent Lite-Theme identity", () => {
  assert.equal(existsSync(new URL("../Lite-theme.json", import.meta.url)), true)
  assert.equal(existsSync(new URL("../komari-theme.json", import.meta.url)), false)
  assert.equal(manifest.name, "Lite-Theme")
  assert.equal(manifest.short, "lite-theme")
  assert.equal(manifest.version, "1.2.6")
  assert.equal(manifest.author, "Nomi")
  assert.equal(manifest.url, "https://github.com/nuomiiiii/Lite-theme")
  assert.equal(manifest.preview, "preview.png")
  assert.equal(manifest.upstream, undefined)
})

test("keeps only settings used by the fixed default card experience", () => {
  assert.deepEqual(keys, [
    "CustomBackgroundImage",
    "CustomMobileBackgroundImage",
    "CustomLogo",
    "ForceTheme",
    "ForcePeakCutEnabled",
    "DefaultProbeChartHours",
    "ShowHomePacketLoss",
    "ShowServerRemainingValue",
    "ShowServerBandwidth",
    "ShowMobileHomeOverview",
    "HomeProbeTasks",
  ])
})

test("does not expose alternate card, map or decoration switches", () => {
  for (const removed of [
    "EnableVerticalCard",
    "ForceCardInline",
    "CardLayout",
    "ShowGlobalMap",
    "ShowServiceTracker",
    "DisableAnimatedMan",
    "DisableOverviewWave",
    "ShowHomeLatency",
    "HideIPv4IPv6Tag",
    "TrafficResetDayOverrides",
    "ServerBillingCurrencyOverrides",
    "DefaultBillingCurrency",
    "CnySymbolStyle",
  ]) {
    assert.equal(keys.includes(removed), false, `${removed} should not be present`)
  }
  assert.doesNotMatch(utils, /TrafficResetDayOverrides/)
  assert.doesNotMatch(utils, /ServerBillingCurrencyOverrides/)
  assert.doesNotMatch(utils, /DefaultBillingCurrency/)
  assert.doesNotMatch(utils, /CnySymbolStyle/)
})

test("shows server bandwidth on cards only when the theme switch is on", () => {
  const setting = settings.find((item) => item.key === "ShowServerBandwidth")
  assert.equal(setting?.type, "switch")
  assert.equal(setting?.default, false)
  assert.match(utils, /bandwidth: typeof server\.bandwidth === "string" \? server\.bandwidth\.trim\(\) : ""/)
  assert.match(serverCard, /readShowServerBandwidth/)
  assert.match(serverCard, /serverBandwidthLabel/)
  assert.doesNotMatch(serverCard, /planDataMod\?\.bandwidth/)
})

test("hides the six homepage overview cards on phones unless the theme switch is on", () => {
  const setting = settings.find((item) => item.key === "ShowMobileHomeOverview")
  const overview = readFileSync(new URL("../src/components/ServerOverview.tsx", import.meta.url), "utf8")
  assert.equal(setting?.type, "switch")
  assert.equal(setting?.default, false)
  assert.match(overview, /readShowMobileHomeOverview/)
  assert.match(overview, /showMobileOverview \? "max-\[967px\]:order-2 max-\[967px\]:mt-4" : "max-\[967px\]:hidden"/)
})

test("shows homepage packet loss only when the theme switch is on", () => {
  const setting = settings.find((item) => item.key === "ShowHomePacketLoss")
  const latency = readFileSync(new URL("../src/components/ServerLatencySummary.tsx", import.meta.url), "utf8")
  assert.equal(setting?.type, "switch")
  assert.equal(setting?.default, false)
  assert.match(latency, /readShowHomePacketLoss/)
  assert.match(latency, /showPacketLoss/)
})

test("shows remaining value next to remaining days when the theme switch is on", () => {
  const setting = settings.find((item) => item.key === "ShowServerRemainingValue")
  const billing = readFileSync(new URL("../src/components/billingInfo.tsx", import.meta.url), "utf8")
  const utils = readFileSync(new URL("../src/lib/utils.ts", import.meta.url), "utf8")
  assert.equal(setting?.type, "switch")
  assert.equal(setting?.default, true)
  assert.match(billing, /readShowServerRemainingValue/)
  assert.match(billing, /formatRemainingValue/)
  assert.match(billing, /data-testid="remaining-value"/)
  assert.match(billing, /billingInfo\.remainingShort/)
  assert.match(billing, /LITE_BLUE/)
  assert.match(serverCard, /remaining_value/)
  assert.match(utils, /remaining_value: typeof server\.remaining_value === "string"/)
})

test("lets admins pick homepage probe tasks per server", () => {
  const titles = settings.filter((item) => item.type === "title").map((item) => item.name)
  const setting = settings.find((item) => item.key === "HomeProbeTasks")
  const serverPage = readFileSync(new URL("../src/pages/Server.tsx", import.meta.url), "utf8")
  assert.deepEqual(titles, ["外观设置", "内容设置", "探测任务"])
  assert.equal(setting?.type, "serverpingtasks")
  assert.deepEqual(setting?.default, {})
  assert.match(String(setting?.help || ""), /最多显示 4 个/)
  assert.match(String(setting?.help || ""), /不会改延迟监测/)
  assert.match(String(setting?.help || ""), /跟随延迟任务顺序/)
  assert.equal(settings.findIndex((item) => item.name === "探测任务"), settings.findIndex((item) => item.key === "HomeProbeTasks") - 1)
  assert.match(serverPage, /readHomeProbeTaskOverrides/)
  assert.match(serverPage, /applyHomeProbeTaskOrder/)
  assert.match(serverPage, /homeProbeOverrideIds/)
  assert.doesNotMatch(networkChart, /HomeProbeTasks|applyHomeProbeTaskOrder/)
  const pingDisplay = readFileSync(new URL("../src/lib/ping-display.ts", import.meta.url), "utf8")
  const liteApi = readFileSync(new URL("../src/lib/lite-api.ts", import.meta.url), "utf8")
  assert.doesNotMatch(pingDisplay, /HomeProbeTasks|applyHomeProbeTaskOrder/)
  assert.doesNotMatch(liteApi, /HomeProbeTasks|applyHomeProbeTaskOrder/)
})

test("lets admins pick the default probe-chart window", () => {
  const setting = settings.find((item) => item.key === "DefaultProbeChartHours")
  assert.equal(setting?.type, "select")
  assert.equal(setting?.default, "1h")
  assert.equal(setting?.options, "1h,6h,12h,24h,3d,7d,30d")
  assert.match(networkChart, /readDefaultProbeChartHours/)
  assert.match(networkChart, /useState<number>\(readDefaultProbeChartHours\)/)
})

test("keeps language, appearance and login in the public header", () => {
  assert.match(header, /<LanguageSwitcher \/>/)
  assert.match(header, /<ModeToggle \/>/)
  assert.match(header, /href="\/admin"/)
  assert.match(header, /fetchAccount/)
  assert.match(header, /data-testid="admin-avatar"/)
  assert.match(header, /\{t\("login"\)\}/)
  assert.doesNotMatch(header, /startIcon|LogIn/)
  assert.match(header, /LITE_BLUE/)
  assert.match(header, /h-\[calc\(var\(--lite-header-height\)\+var\(--safe-area-top\)\)\]/)
  assert.match(header, /lite-page-shell/)
  assert.match(header, /fixed inset-x-0 top-0/)
  assert.doesNotMatch(header, /liveConnection|useWebSocketContext/)
  assert.match(themeSwitcher, /AutoThemeIcon/)
  assert.doesNotMatch(themeSwitcher, /BrightnessAuto/)
  assert.doesNotMatch(themeSwitcher, /SunMoon/)
})

test("shows the site description after the header divider on mobile", () => {
  assert.match(header, /site_desc/)
  assert.doesNotMatch(header, /hidden min-w-0 truncate text-base text-\[#7A8792\] sm:inline/)
  assert.match(header, /whitespace-nowrap/)
  assert.match(header, /text-\[13px\] leading-5/)
})

test("does not render IP addresses on public cards or detail identity", () => {
  assert.doesNotMatch(serverCard, /\.ipv[46]|IPv[46]/)
  assert.doesNotMatch(detailOverview, /\.ipv[46]|IPv[46]/)
})

test("renders country flags as fixed-size SVGs without a framed background", () => {
  const flag = readFileSync(new URL("../src/components/ServerFlag.tsx", import.meta.url), "utf8")
  assert.doesNotMatch(serverCard, /rounded-\[4px\] border border-\[#DDE4E9\] bg-\[#F4F7F9\]/)
  assert.match(serverCard, /<ServerFlag /)
  assert.match(flag, /country-flag-icons\/react\/3x2/)
  assert.match(flag, /h-\[15px\] w-\[22px\]/)
  assert.match(flag, /h-\[18px\] w-\[27px\]/)
})

test("lets visitors isolate one or more ping-task curves", () => {
  assert.match(networkChart, /nextActiveCharts/)
  assert.match(networkChart, /monitorNameForId/)
  assert.match(networkChart, /setActiveCharts\(\[\.\.\.chartDataKey\]\)/)
  assert.match(networkChart, /toggleChart/)
  assert.match(networkChart, /monitor\.allTasks/)
  assert.match(networkChart, /HISTORY_TIME_OPTIONS/)
  assert.match(networkChart, /selectedTaskSampleCount/)
  assert.match(networkChart, /formatCompactTime/)
})
