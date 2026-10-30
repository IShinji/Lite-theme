import { COUNTRY_CENTERS } from "./globe-countries.ts"
import { type NodeInfo } from "./fleet-globe-data.ts"

/** 统一名里的城市（英文全称、首字母大写、不缩写）-> [纬度, 经度, 地球仪上显示的名字]。只是让点落在城市上；表里没有的城市退回国家中心，不影响点出现。 */
const CITY_CENTERS: Record<string, [number, number, string]> = {
  HoChiMinhCity: [10.82, 106.63, "胡志明市"], Hanoi: [21.03, 105.85, "河内"], Bangkok: [13.76, 100.5, "曼谷"],
  Singapore: [1.35, 103.82, "新加坡"], KualaLumpur: [3.14, 101.69, "吉隆坡"], Jakarta: [-6.2, 106.85, "雅加达"], Manila: [14.6, 120.98, "马尼拉"],
  Seoul: [37.57, 126.98, "首尔"], Taipei: [25.03, 121.57, "台北"], Tokyo: [35.68, 139.69, "东京"], Osaka: [34.69, 135.5, "大阪"],
  Mumbai: [19.08, 72.88, "孟买"], Delhi: [28.61, 77.21, "德里"], Dubai: [25.2, 55.27, "迪拜"], TelAviv: [32.09, 34.78, "特拉维夫"],
  Sydney: [-33.87, 151.21, "悉尼"], Melbourne: [-37.81, 144.96, "墨尔本"], Auckland: [-36.85, 174.76, "奥克兰"],
  London: [51.51, -0.13, "伦敦"], Paris: [48.86, 2.35, "巴黎"], Frankfurt: [50.11, 8.68, "法兰克福"], Amsterdam: [52.37, 4.9, "阿姆斯特丹"],
  Zurich: [47.38, 8.54, "苏黎世"], Madrid: [40.42, -3.7, "马德里"], Milan: [45.46, 9.19, "米兰"], Stockholm: [59.33, 18.07, "斯德哥尔摩"],
  Warsaw: [52.23, 21.01, "华沙"], Moscow: [55.76, 37.62, "莫斯科"], Istanbul: [41.01, 28.98, "伊斯坦布尔"],
  NewYork: [40.71, -74.01, "纽约"], Ashburn: [39.04, -77.49, "阿什本"], Miami: [25.76, -80.19, "迈阿密"], Chicago: [41.88, -87.63, "芝加哥"],
  Dallas: [32.78, -96.8, "达拉斯"], Houston: [29.76, -95.37, "休斯顿"], Denver: [39.74, -104.99, "丹佛"], Phoenix: [33.45, -112.07, "凤凰城"],
  LosAngeles: [34.05, -118.24, "洛杉矶"], SanJose: [37.34, -121.89, "圣何塞"], SanFrancisco: [37.77, -122.42, "旧金山"], Seattle: [47.61, -122.33, "西雅图"],
  Toronto: [43.65, -79.38, "多伦多"], Montreal: [45.5, -73.57, "蒙特利尔"], Vancouver: [49.28, -123.12, "温哥华"],
  SaoPaulo: [-23.55, -46.63, "圣保罗"], Santiago: [-33.45, -70.67, "圣地亚哥"], MexicoCity: [19.43, -99.13, "墨西哥城"],
  Johannesburg: [-26.2, 28.05, "约翰内斯堡"], Lagos: [6.52, 3.38, "拉各斯"], Cairo: [30.04, 31.24, "开罗"],
  Beijing: [39.9, 116.4, "北京"], Shanghai: [31.23, 121.47, "上海"], Guangzhou: [23.13, 113.26, "广州"], Shenzhen: [22.54, 114.06, "深圳"],
  Shenyang: [41.8, 123.43, "沈阳"], Shiyan: [32.65, 110.78, "十堰"], Xian: [34.34, 108.94, "西安"], Chengdu: [30.57, 104.07, "成都"],
}

export type DiscoverServer = { name: string; country_code?: string }

/**
 * 自动发现：Lite 面板的实时节点里，发布的节点列表里没有的，按统一名「区域-城市-…」自己定位，新机器接入后不用改主题就有点。
 * 定位顺序：城市表命中 > 节点自带国家码的国家中心 > 名字里区域码的国家中心；都没有就不画。点的 id 就是节点名，所以实时采样自动对上。
 */
export function discoverNodes(servers: DiscoverServer[], known: NodeInfo[]): NodeInfo[] {
  const seen = new Set(known.map((n) => n.id))
  const out: NodeInfo[] = []
  for (const s of servers) {
    const id = String(s.name || "").trim()
    if (!id || seen.has(id)) continue
    const [region, cityPart] = id.split("-")
    const cc = String(s.country_code || "").trim().toUpperCase()
    const rc = /^[A-Z]{2}$/.test(region || "") ? region : "" // 统一名的区域码是大写两位；小写的 my-random-box 不是统一名，不能当马来西亚
    const c = cityPart ? CITY_CENTERS[cityPart] : undefined
    if (c) { out.push({ id, city: c[2], lat: c[0], lon: c[1] }); seen.add(id); continue }
    const code = COUNTRY_CENTERS[cc] ? cc : COUNTRY_CENTERS[rc] ? rc : ""
    if (!code) continue
    const [lat, lon] = COUNTRY_CENTERS[code]
    out.push({ id, city: code, lat, lon })
    seen.add(id)
  }
  return out
}

/** 地球仪上显示的城市名：统一名里的城市在表里就用表里的中文名（所有机器同城同名才会合成一个点）；香港没有城市段，按区域码；其余用发布的名字。 */
export function displayCity(id: string, given: string): string {
  const [region, cityPart] = id.split("-")
  const c = cityPart ? CITY_CENTERS[cityPart] : undefined
  if (c) return c[2]
  if (region === "HK") return "香港"
  return given
}

const MAX_PUBLISHED_NODES = 200

/** 解析拓扑 JSON 里发布的 nodes（接入时记下的坐标，由 fleet 的发布脚本写入）。只收合规的：id 是统一名字符、坐标在范围内，去重并限量；其余丢弃。 */
export function parseNodes(input: unknown): NodeInfo[] {
  let data = input
  if (typeof data === "string") {
    try { data = JSON.parse(data) } catch { return [] }
  }
  const list = data && typeof data === "object" ? (data as Record<string, unknown>).nodes : undefined
  if (!Array.isArray(list)) return []
  const out: NodeInfo[] = []
  const seen = new Set<string>()
  for (const item of list) {
    if (!item || typeof item !== "object") continue
    const o = item as Record<string, unknown>
    const id = typeof o.id === "string" ? o.id.trim() : ""
    const city = typeof o.city === "string" ? o.city.trim() : ""
    const lat = o.lat
    const lon = o.lon
    if (!/^[A-Za-z0-9._-]{1,80}$/.test(id) || !city || city.length > 40 || seen.has(id)) continue
    if (typeof lat !== "number" || typeof lon !== "number" || !Number.isFinite(lat) || !Number.isFinite(lon)) continue
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue
    seen.add(id)
    out.push({ id, city, lat, lon })
    if (out.length >= MAX_PUBLISHED_NODES) break
  }
  return out
}

/** 节点目录 = 发布的节点（坐标最准，显示名统一）+ Lite 实时节点里没发布的（城市表 > 国家中心）。主题里没有任何写死的节点。 */
export function resolveCatalog(published: NodeInfo[], servers: DiscoverServer[]): NodeInfo[] {
  const base = published.map((n) => ({ ...n, city: displayCity(n.id, n.city) }))
  return [...base, ...discoverNodes(servers, base)]
}
