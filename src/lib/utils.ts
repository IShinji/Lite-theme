import { SharedClient } from "@/hooks/use-rpc2"
import { detectCanadianDollarCurrency, detectHongKongDollarCurrency, getStaticCurrencyLabel } from "@/lib/currency-label"
import { formatBytes } from "@/lib/format"
import { leftoverStatusUuids, listLiteNodes, resolveLiteServerEntries } from "@/lib/lite-node-list"
import { uuidToNumber } from "@/lib/server-route"
import { mergeThemeBillingDataMod, remainingExpiryDaysCeil, resolveThemeBillingStartDate } from "@/lib/theme-billing"
import { LiteServer, LiteWebsocketResponse } from "@/types/lite-api"
import { type ClassValue, clsx } from "clsx"
import dayjs from "dayjs"
import { twMerge } from "tailwind-merge"

export { uuidToNumber } from "@/lib/server-route"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatLiteInfo(now: number, serverInfo: LiteServer) {
  const lastActiveRaw = serverInfo.last_active || ""
  const lastActiveTime = lastActiveRaw.startsWith("000") ? 0 : parseISOTimestamp(lastActiveRaw)
  // 优先使用 Lite 后端权威 online 字段（基于连接状态与 presence TTL）。
  // 仅在缺失时回退到 now - last_active <= 30s 的时间差判断。
  // 这样可以避免访客本地时钟与服务器时钟偏差(>30s)造成的误判离线。
  const onlineFlag =
    typeof serverInfo.online === "boolean"
      ? serverInfo.online
      : Number.isFinite(lastActiveTime) && lastActiveTime > 0 && now - lastActiveTime <= 30000
  return {
    ...serverInfo,
    cpu: serverInfo.state.cpu || 0,
    process: serverInfo.state.process_count || 0,
    up: serverInfo.state.net_out_speed / 1024 / 1024 || 0,
    down: serverInfo.state.net_in_speed / 1024 / 1024 || 0,
    last_active_time_string: lastActiveTime ? dayjs(lastActiveTime).format("YYYY-MM-DD HH:mm:ss") : "",
    online: onlineFlag,
    uptime: serverInfo.state.uptime || 0,
    version: serverInfo.host.version || null,
    tcp: serverInfo.state.tcp_conn_count || 0,
    udp: serverInfo.state.udp_conn_count || 0,
    mem: (serverInfo.state.mem_used / serverInfo.host.mem_total) * 100 || 0,
    swap: (serverInfo.state.swap_used / serverInfo.host.swap_total) * 100 || 0,
    disk: (serverInfo.state.disk_used / serverInfo.host.disk_total) * 100 || 0,
    stg: (serverInfo.state.disk_used / serverInfo.host.disk_total) * 100 || 0,
    country_code: serverInfo.country_code,
    platform: serverInfo.host.platform || "",
    net_out_transfer: serverInfo.state.net_out_transfer || 0,
    net_in_transfer: serverInfo.state.net_in_transfer || 0,
    arch: serverInfo.host.arch || "",
    mem_total: serverInfo.host.mem_total || 0,
    swap_total: serverInfo.host.swap_total || 0,
    disk_total: serverInfo.host.disk_total || 0,
    boot_time: serverInfo.host.boot_time || 0,
    platform_version: serverInfo.host.platform_version || "",
    cpu_cores: serverInfo.host.cpu_cores,
    load_1: serverInfo.state.load_1?.toFixed(2) || 0.0,
    load_5: serverInfo.state.load_5?.toFixed(2) || 0.0,
    load_15: serverInfo.state.load_15?.toFixed(2) || 0.0,
    public_note: handlePublicNote(serverInfo.uuid || serverInfo.id, serverInfo.public_note || ""),
    traffic_limit: serverInfo.traffic_limit || 0,
    traffic_limit_type: serverInfo.traffic_limit_type || "sum",
    traffic_reset_day: serverInfo.traffic_reset_day || 0,
    expired_at: serverInfo.expired_at || "",
    expiry_timezone: serverInfo.expiry_timezone || "",
  }
}

export function parseLiteWebsocketMessage(raw: string | undefined | null): LiteWebsocketResponse | null {
  if (!raw) return null
  try {
    const data = JSON.parse(raw) as LiteWebsocketResponse
    if (!data || typeof data !== "object" || !Array.isArray(data.servers)) return null
    return data
  } catch {
    return null
  }
}

export function calcTrafficUsed(up: number, down: number, type: string): number {
  switch (type) {
    case "max": return Math.max(up, down)
    case "min": return Math.min(up, down)
    case "up": return up
    case "down": return down
    default: return up + down
  }
}

export function getDaysBetweenDatesWithAutoRenewal({ cycle, startDate, endDate }: BillingData): {
  days: number
  cycleLabel: string
  remainingPercentage: number
} {
  let months = 1
  // 套餐资费
  let cycleLabel = cycle

  const cycleLower = cycle.toLowerCase()
  const yearsMatch = cycleLower.match(/^(\d+)年$/)

  if (yearsMatch) {
    const y = parseInt(yearsMatch[1])
    cycleLabel = cycle
    months = y * 12
  } else {
    switch (cycleLower) {
      case "月":
      case "m":
      case "mo":
      case "month":
      case "monthly":
        cycleLabel = "月"
        months = 1
        break
      case "年":
      case "y":
      case "yr":
      case "year":
      case "annual":
        cycleLabel = "年"
        months = 12
        break
      case "季":
      case "q":
      case "qr":
      case "quarterly":
        cycleLabel = "季"
        months = 3
        break
      case "半":
      case "半年":
      case "h":
      case "half":
      case "semi-annually":
        cycleLabel = "半年"
        months = 6
        break
      case "一次性":
        cycleLabel = "一次性"
        months = 1
        break
      default:
        cycleLabel = cycle
        break
    }
  }

  const nowTime = new Date().getTime()
  const remaining = remainingExpiryDaysCeil(endDate, nowTime)
  const days = remaining ?? 0
  const cycleDays = Math.max(dayjs(endDate).diff(startDate, "day"), 30 * months)
  const remainingMs = remaining === null ? 0 : Math.max(0, dayjs(endDate).valueOf() - nowTime)
  const remainingPercentage = cycleDays > 0 ? Math.min(1, remainingMs / (cycleDays * 24 * 60 * 60 * 1000)) : 0

  return {
    days,
    cycleLabel,
    remainingPercentage,
  }
}

export function getNextCycleTime(startDate: number, months: number, specifiedDate: number): number {
  const start = dayjs(startDate)
  const checkDate = dayjs(specifiedDate)

  if (!start.isValid() || months <= 0) {
    throw new Error("参数无效：请检查起始日期、周期月份数和指定日期。")
  }

  let nextDate = start

  // 循环增加周期直到大于当前日期
  let whileStatus = true
  while (whileStatus) {
    nextDate = nextDate.add(months, "month")
    whileStatus = nextDate.valueOf() <= checkDate.valueOf()
  }

  return nextDate.valueOf() // 返回时间毫秒数
}

export function getDaysBetweenDates(date1: string, date2: string): number {
  return remainingExpiryDaysCeil(date1, new Date(date2).getTime()) ?? 0
}

export function parseISOTimestamp(isoString: string): number {
  return new Date(isoString).getTime()
}

export function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  const day = date.getDate()
  const hours = date.getHours().toString().padStart(2, "0")
  const minutes = date.getMinutes().toString().padStart(2, "0")
  const seconds = date.getSeconds().toString().padStart(2, "0")
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
}

interface BillingData {
  startDate: string
  endDate: string
  autoRenewal: string
  cycle: string
  amount: string
  currency?: string
}

interface PlanData {
  bandwidth: string
  trafficVol: string
  trafficType: string
  IPv4: string
  IPv6: string
  networkRoute: string
  extra: string
}

export interface PublicNoteData {
  billingDataMod?: BillingData
  planDataMod?: PlanData
}

function getCurrencyLabel(currency: string): string | undefined {
  return getStaticCurrencyLabel(currency)
}

export function normalizeBillingCurrency(currency?: unknown): string {
  const raw = typeof currency === "string" ? currency.trim() : ""
  if (!raw) return ""

  const upper = raw.toUpperCase()
  const compact = upper.replace(/\s+/g, "")

  if (["CNY", "RMB", "CN\u00a5", "CN\uffe5"].includes(compact) || raw.includes("\u4eba\u6c11\u5e01")) return "CNY"
  if (["JPY", "JP\u00a5", "JP\uffe5"].includes(compact) || raw.includes("\u65e5\u5143") || raw.includes("\u5186")) return "JPY"

  // Lite 的 currency 字段是用户输入；中文环境中的 ¥/￥ 默认按 CNY 处理。
  if (compact === "\u00a5" || compact === "\uffe5") return "CNY"

  if (compact === "$") return "USD"
  if (compact === "\u20ac") return "EUR"
  if (compact === "\u00a3") return "GBP"
  if (compact === "US$") return "USD"
  if (compact === "HK$") return "HKD"
  if (compact === "NT$") return "TWD"
  if (compact === "CA$" || compact === "C$") return "CAD"

  return compact || raw
}

export function stripCurrencyMarks(amount: string): string {
  return amount
    .trim()
    .replace(
      /^(?:CNY|RMB|JPY|USD|EUR|GBP|HKD|TWD|KRW|SGD|CAD|AUD|CN\u00a5|CN\uffe5|JP\u00a5|JP\uffe5|US\$|HK\$|NT\$|CA\$|C\$|\$|\u20ac|\u00a3|\u00a5|\uffe5)\s*/i,
      "",
    )
    .replace(
      /\s*(?:CNY|RMB|JPY|USD|EUR|GBP|HKD|TWD|KRW|SGD|CAD|AUD|CN\u00a5|CN\uffe5|JP\u00a5|JP\uffe5|US\$|HK\$|NT\$|CA\$|C\$|\$|\u20ac|\u00a3|\u00a5|\uffe5)$/i,
      "",
    )
    .trim()
}

export function parseBillingAmountNumber(amount: string): number | null {
  const rawAmount = String(amount || "").trim()
  if (!rawAmount || rawAmount === "-1") {
    return null
  }

  const normalized = stripCurrencyMarks(rawAmount).replace(/,/g, "")
  const value = Number(normalized)
  return Number.isFinite(value) ? value : null
}

export function formatBillingAmount(amount: string, currency?: string): string {
  const rawAmount = String(amount || "").trim()
  if (!rawAmount || rawAmount === "0" || rawAmount === "-1") {
    return rawAmount
  }

  const normalizedCurrency = normalizeBillingCurrency(currency) || detectCanadianDollarCurrency(rawAmount) || detectHongKongDollarCurrency(rawAmount)
  if (!normalizedCurrency) {
    return rawAmount
  }

  const label = getCurrencyLabel(normalizedCurrency) || `${normalizedCurrency} `
  const value = stripCurrencyMarks(rawAmount)
  return value ? `${label}${value}` : rawAmount
}

export function resolveThemeBillingCurrency(server: any, existingCurrency?: string): string {
  const tagCurrency = readTagCurrency(server)
  if (tagCurrency) return tagCurrency
  return normalizeBillingCurrency(server?.currency) || normalizeBillingCurrency(existingCurrency)
}

function readTagCurrency(server: any): string {
  const tags = typeof server?.tags === "string" ? server.tags : ""
  if (!tags) return ""
  return normalizeBillingCurrency(parseTagMetadata(tags).currency)
}

export function parsePublicNote(publicNote: string): PublicNoteData | null {
  try {
    const raw = publicNote?.trim()
    if (!raw || raw[0] !== "{") {
      return null
    }
    const data = JSON.parse(raw)
    if (!data.billingDataMod && !data.planDataMod) {
      return null
    }
    if (data.billingDataMod && !data.planDataMod) {
      return {
        billingDataMod: {
          startDate: data.billingDataMod.startDate || "",
          endDate: data.billingDataMod.endDate,
          autoRenewal: data.billingDataMod.autoRenewal || "",
          cycle: data.billingDataMod.cycle || "",
          amount: data.billingDataMod.amount || "",
          currency: data.billingDataMod.currency || "",
        },
      }
    }
    if (!data.billingDataMod && data.planDataMod) {
      return {
        planDataMod: {
          bandwidth: data.planDataMod.bandwidth || "",
          trafficVol: data.planDataMod.trafficVol || "",
          trafficType: data.planDataMod.trafficType || "",
          IPv4: data.planDataMod.IPv4 || "",
          IPv6: data.planDataMod.IPv6 || "",
          networkRoute: data.planDataMod.networkRoute || "",
          extra: data.planDataMod.extra || "",
        },
      }
    }

    return {
      billingDataMod: {
        startDate: data.billingDataMod.startDate || "",
        endDate: data.billingDataMod.endDate,
        autoRenewal: data.billingDataMod.autoRenewal || "",
        cycle: data.billingDataMod.cycle || "",
        amount: data.billingDataMod.amount || "",
        currency: data.billingDataMod.currency || "",
      },
      planDataMod: {
        bandwidth: data.planDataMod.bandwidth || "",
        trafficVol: data.planDataMod.trafficVol || "",
        trafficType: data.planDataMod.trafficType || "",
        IPv4: data.planDataMod.IPv4 || "",
        IPv6: data.planDataMod.IPv6 || "",
        networkRoute: data.planDataMod.networkRoute || "",
        extra: data.planDataMod.extra || "",
      },
    }
  } catch {
    return null
  }
}

// Cache only current public_note values. Never resurrect an empty note from old
// storage, otherwise deleted/recreated nodes can inherit stale card metadata.
export function handlePublicNote(serverKey: string | number, publicNote: string): string {
  const storageKey = `server_${serverKey}_public_note`

  if (!publicNote) {
    sessionStorage.removeItem(storageKey)
    return ""
  }

  sessionStorage.setItem(storageKey, publicNote)
  return publicNote
}

let liteServerCache: any[] = []

const countryFlagToCode = (flag: string): string => {
  const value = String(flag || "").trim()
  if (/^[a-z]{2}$/i.test(value)) return value.toLowerCase()
  return [...value].map((c) => String.fromCharCode(c.codePointAt(0)! - 127397 + 32)).join("")
}

// 根据 common:getNodes 的字段构造/合并公开备注（public_note）
// 目标结构：{ billingDataMod: { startDate,endDate,autoRenewal,cycle,amount }, planDataMod: { bandwidth,trafficVol,trafficType,IPv4,IPv6,networkRoute,extra } }
// 周期标签：使用阿拉伯数字+年/月，避免"五年"等中文数字给下游 parseCycleDays 带来识别歧义。
const CYCLE_MAP: Record<number, string> = { 30: "月", 92: "季", 184: "半年", 365: "年", 730: "2年", 1095: "3年", 1825: "5年" }

function deriveCycleLabel(billing_cycle?: number): string {
  const bc = Number(billing_cycle || 0)
  if (!bc) return ""
  if (bc === -1 || bc === 0) return "一次性"
  for (const [days, label] of Object.entries(CYCLE_MAP)) {
    if (Math.abs(bc - Number(days)) <= 3) return label
  }
  const y = Math.round(bc / 365)
  if (y >= 1 && y <= 10) return y === 1 ? "年" : `${y}年`
  return `${bc}天`
}

// 颜色名与 ISO 货币代码两个集合互不相交,可以共用 <...> 语法。
const TAG_COLORS = [
  "Gray", "Gold", "Bronze", "Brown", "Yellow", "Amber", "Orange", "Tomato",
  "Red", "Ruby", "Crimson", "Pink", "Plum", "Purple", "Violet", "Iris",
  "Indigo", "Blue", "Cyan", "Teal", "Jade", "Green", "Grass", "Lime", "Mint", "Sky",
]
const TAG_CURRENCIES = ["CNY", "JPY", "USD", "EUR", "GBP", "HKD", "TWD", "KRW", "SGD", "CAD", "AUD"]

const TAG_COLOR_EXTRACT = new RegExp(`<\\s*(${TAG_COLORS.join("|")})\\s*>`, "i")
const TAG_COLOR_REMOVE = new RegExp(`<\\s*(?:${TAG_COLORS.join("|")})\\s*>`, "ig")
const TAG_CURRENCY_EXTRACT = new RegExp(`<\\s*(${TAG_CURRENCIES.join("|")})\\s*>`, "i")
const TAG_CURRENCY_REMOVE = new RegExp(`<\\s*(?:${TAG_CURRENCIES.join("|")})\\s*>`, "ig")
const TAG_TRAFFIC_RESET_REMOVE = /<\s*TRD\s*:\s*\d{1,2}\s*>/ig

// Parse display tags and silently remove legacy metadata that should not be public.
export function parseTagMetadata(tags: string): { text: string; currency: string } {
  if (!tags) return { text: "", currency: "" }
  let currency = ""
  const cleanedParts: string[] = []
  for (const rawPart of tags.split(";")) {
    const part = rawPart.trim()
    if (!part) continue

    // 第一次遇到的 currency tag 生效(后续覆盖不生效,避免 <JPY><USD> 这种歧义写法)
    if (!currency) {
      const m = part.match(TAG_CURRENCY_EXTRACT)
      if (m) currency = m[1].toUpperCase()
    }

    const colorMatch = part.match(TAG_COLOR_EXTRACT)
    const color = colorMatch ? colorMatch[1] : ""
    const text = part.replace(TAG_COLOR_REMOVE, "").replace(TAG_CURRENCY_REMOVE, "").replace(TAG_TRAFFIC_RESET_REMOVE, "").trim()
    if (!text) continue
    cleanedParts.push(color ? `${color}:${text}` : text)
  }
  return { text: cleanedParts.join(","), currency }
}

// 清洗 tags 用于显示;元标签在此被静默剥离。
function sanitizeTags(tags: string): string {
  return parseTagMetadata(tags).text
}

function parseTrafficResetDay(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined
  const day = Number(value)
  if (!Number.isInteger(day) || day < 1 || day > 31) return undefined
  return day
}

function resolveTrafficResetDay(server: any): number | undefined {
  return parseTrafficResetDay(server?.traffic_reset_day)
}

function buildPublicNoteFromNode(server: any, existingPublicNote?: string): string {
  try {
    // 如果已有结构化的 public_note，先解析出来以便合并
    const existing = parsePublicNote(existingPublicNote || "") || undefined
    const bc: number = Number(server?.billing_cycle || 0)
    const autoRenewal: string = server?.auto_renewal === true || server?.auto_renewal === 1 || server?.auto_renewal === "1" ? "1" : "0"
    const cycle: string = deriveCycleLabel(bc) || String(bc || "")
    const currency = resolveThemeBillingCurrency(server, existing?.billingDataMod?.currency)
    const amount: string =
      server?.price != null && server?.price !== 0
        ? server.price === -1
          ? "-1"
          : String(server.price)
        : ""

    // 起止时间：优先公开备注里的 billingDataMod.startDate，否则用 expired_at - billing_cycle 回推。
    // 不再把节点数据库创建时间当作计费周期开始。
    const expiredRaw: string = typeof server?.expired_at === "string" ? server.expired_at : ""
    const startDateCandidate = resolveThemeBillingStartDate(server, existing?.billingDataMod?.startDate)
    const startDate =
      startDateCandidate && dayjs(startDateCandidate).isValid() && dayjs(startDateCandidate).year() < 2 ? null : startDateCandidate

    // 计划/流量信息（如果 traffic_limit 为 0，则不添加流量相关信息）
    const trafficLimitNum = Number(server?.traffic_limit)
    const hasTraffic =
      server?.traffic_limit != null && server?.traffic_limit !== "" && !Number.isNaN(trafficLimitNum) && trafficLimitNum > 0
    const trafficVol: string = hasTraffic ? formatBytes(trafficLimitNum) : ""
    const trafficTypeFromNode: string = hasTraffic ? server?.traffic_limit_type || "" : ""
    const extraFromNode: string = existing ? "" : (
      server?.public_remark != null && server.public_remark !== ""
        ? String(server.public_remark)
        : server?.tags
          ? sanitizeTags(String(server.tags))
          : "")

    const merged = {
      billingDataMod: mergeThemeBillingDataMod(existing?.billingDataMod, {
        expiredAt: expiredRaw,
        startDate,
        autoRenewal,
        cycle,
        amount,
        currency,
      }),
      planDataMod: {
        bandwidth: existing?.planDataMod?.bandwidth || "",
        // 当 traffic_limit==0 时，不从节点写入流量信息
        trafficVol: existing?.planDataMod?.trafficVol || trafficVol,
        trafficType: existing?.planDataMod?.trafficType || trafficTypeFromNode,
        IPv4: existing?.planDataMod?.IPv4 || (server?.ipv4 ? "1" : ""),
        IPv6: existing?.planDataMod?.IPv6 || (server?.ipv6 ? "1" : ""),
        networkRoute: existing?.planDataMod?.networkRoute || "",
        // 若存在 public_remark，优先写入 extra；否则保留已有或使用 tags
        extra: existing?.planDataMod?.extra || extraFromNode || "",
      },
    }

    return JSON.stringify(merged)
  } catch (e) {
    console.error("buildPublicNoteFromNode error:", e)
    return existingPublicNote || ""
  }
}

export const normalizeLiteServerStatus = (data: any, nodes: Record<string, any>): LiteWebsocketResponse => {
  // 直接使用本轮已完成的节点请求，避免异步缓存回调晚于状态转换。
  liteServerCache = listLiteNodes(nodes)

  // 节点表为空时不要用 live status 凑卡片，否则删除后残留的 agent 状态会变成幽灵卡片。
  if (liteServerCache.length === 0) {
    return {
      now: Date.now(),
      servers: [],
    }
  }

  const entries = resolveLiteServerEntries(nodes, data)
  const leftover = leftoverStatusUuids(
    entries.map((entry) => entry.uuid),
    data,
  )
  // 状态里出现、节点表还没有的 UUID：不渲染，只刷新节点表。新机器下一轮出现，已删除机器不会变成乱码卡片。
  if (leftover.length > 0) {
    getLiteNodes(true).catch(() => {
      // 下一轮轮询继续尝试刷新节点表
    })
  }

  const servers: any[] = entries.map((entry) => {
    const { uuid, node: server, status } = entry
    const countryCode = server?.region ? countryFlagToCode(String(server.region)) : ""
    const trafficResetDay = resolveTrafficResetDay(server)

    const bootTime = status ? new Date(status.time).getTime() / 1000 - (status.uptime || 0) : 0

    const host = {
      platform: server.os,
      platform_version: server.kernel_version,
      cpu: [server.cpu_name],
      cpu_cores: Number(server.cpu_cores) || 0,
      gpu: server.gpu_name ? [server.gpu_name] : [],
      mem_total: server.mem_total,
      disk_total: server.disk_total,
      swap_total: server.swap_total,
      arch: server.arch,
      boot_time: bootTime,
      version: "",
    }

    const state = status
      ? {
          cpu: status.cpu || 0,
          mem_used: status.ram || 0,
          swap_used: status.swap || 0,
          disk_used: status.disk || 0,
          net_in_transfer: status.net_total_down || 0,
          net_out_transfer: status.net_total_up || 0,
          net_in_speed: status.net_in || 0,
          net_out_speed: status.net_out || 0,
          uptime: status.uptime || 0,
          load_1: status.load || 0,
          load_5: status.load5 || 0,
          load_15: status.load15 || 0,
          tcp_conn_count: status.connections || 0,
          udp_conn_count: status.connections_udp || 0,
          process_count: status.process || 0,
          temperatures: status.temp > 0 ? [{ Name: "CPU", Temperature: status.temp }] : [],
          gpu: server.gpu_name && typeof status.gpu === "number" ? [status.gpu] : [],
        }
      : {
          cpu: 0,
          mem_used: 0,
          swap_used: 0,
          disk_used: 0,
          net_in_transfer: 0,
          net_out_transfer: 0,
          net_in_speed: 0,
          net_out_speed: 0,
          uptime: 0,
          load_1: 0,
          load_5: 0,
          load_15: 0,
          tcp_conn_count: 0,
          udp_conn_count: 0,
          process_count: 0,
          temperatures: [],
          gpu: [],
        }

    return {
      uuid,
      id: uuidToNumber(uuid),
      name: server.name,
      public_note: buildPublicNoteFromNode(server, server.public_remark || ""),
      last_active: status && status.time ? status.time : "0000-00-00T00:00:00Z",
      country_code: countryCode,
      display_index: -server.weight || 0,
      host,
      state,
      traffic_limit: server.traffic_limit || 0,
      traffic_limit_type: server.traffic_limit_type || "sum",
      traffic_reset_day: trafficResetDay || 0,
      expired_at: server.expired_at || "",
      expiry_timezone: typeof server.expiry_timezone === "string" ? server.expiry_timezone : "",
      remaining_value: typeof server.remaining_value === "string" ? server.remaining_value : "",
      remaining_value_currency: typeof server.remaining_value_currency === "string" ? server.remaining_value_currency : "",
      online: status ? status.online === true : false,
      tags: typeof server.tags === "string" ? server.tags : "",
      bandwidth: typeof server.bandwidth === "string" ? server.bandwidth.trim() : "",
      currency: typeof server.currency === "string" ? server.currency : "",
    }
  })

  return {
    now: Date.now(),
    servers,
  }
}

let __nodesCache__ : any = null
let __nodesCachePromise__: Promise<any> | null = null
let __nodesCacheTimer__: ReturnType<typeof setTimeout> | null = null
const NODES_CACHE_TTL_MS = 30000

function clearLiteNodesCache() {
  __nodesCache__ = null
  if (__nodesCacheTimer__) {
    clearTimeout(__nodesCacheTimer__)
    __nodesCacheTimer__ = null
  }
}

export const getLiteNodes = async (force = false) => {
  if (force) {
    clearLiteNodesCache()
  }

  // 命中缓存，直接返回
  if (__nodesCache__) {
    return __nodesCache__
  }

  // 若已有进行中的请求，复用同一个 Promise，避免并发重复请求
  if (__nodesCachePromise__) {
    return __nodesCachePromise__
  }

  // 建立并发锁（in-flight Promise）
  __nodesCachePromise__ = SharedClient()
    .call("common:getNodes")
    .then((res) => {
      __nodesCache__ = res
      if (__nodesCacheTimer__) {
        clearTimeout(__nodesCacheTimer__)
      }
      __nodesCacheTimer__ = setTimeout(() => {
        __nodesCache__ = null
        __nodesCacheTimer__ = null
      }, NODES_CACHE_TTL_MS)
      return __nodesCache__
    })
    .catch((err) => {
      // 失败不污染缓存，下次可重试
      clearLiteNodesCache()
      throw err
    })
    .finally(() => {
      // 请求结束，释放并发锁
      __nodesCachePromise__ = null
    })

  return __nodesCachePromise__
}
