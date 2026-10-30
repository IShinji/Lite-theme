// 地球仪用的本地经纬度表：城市来自节点名里的英文城市词，国家来自节点自带的国家码。
// 全部是城市级/国家级示意坐标；查不到的节点不画。零网络、零依赖。

export type GlobeNode = { country_code?: string; name?: string; online?: boolean }
export type GlobePosition = { lat: number; lon: number }
export type GlobeMarker = GlobePosition & { key: string; total: number; online: number }

export const MAX_GLOBE_MARKERS = 48

const CITIES: Record<string, [number, number]> = {
  "tokyo": [35.7, 139.7],
  "osaka": [34.7, 135.5],
  "seoul": [37.6, 127.0],
  "singapore": [1.35, 103.8],
  "hongkong": [22.3, 114.2],
  "taipei": [25.0, 121.5],
  "shanghai": [31.2, 121.5],
  "beijing": [39.9, 116.4],
  "shenzhen": [22.5, 114.1],
  "guangzhou": [23.1, 113.3],
  "shenyang": [41.8, 123.4],
  "xian": [34.3, 108.9],
  "chengdu": [30.7, 104.1],
  "mumbai": [19.1, 72.9],
  "bangalore": [12.97, 77.6],
  "delhi": [28.6, 77.2],
  "dubai": [25.2, 55.3],
  "tel-aviv": [32.1, 34.8],
  "bangkok": [13.75, 100.5],
  "jakarta": [-6.2, 106.8],
  "kualalumpur": [3.14, 101.7],
  "manila": [14.6, 121.0],
  "hanoi": [21.0, 105.8],
  "sydney": [-33.9, 151.2],
  "melbourne": [-37.8, 145.0],
  "perth": [-31.95, 115.9],
  "auckland": [-36.85, 174.8],
  "london": [51.5, -0.1],
  "manchester": [53.5, -2.2],
  "frankfurt": [50.1, 8.7],
  "berlin": [52.5, 13.4],
  "paris": [48.9, 2.35],
  "amsterdam": [52.4, 4.9],
  "madrid": [40.4, -3.7],
  "milan": [45.5, 9.2],
  "zurich": [47.4, 8.5],
  "stockholm": [59.3, 18.1],
  "helsinki": [60.2, 24.9],
  "warsaw": [52.2, 21.0],
  "moscow": [55.75, 37.6],
  "istanbul": [41.0, 29.0],
  "dublin": [53.3, -6.3],
  "seattle": [47.6, -122.3],
  "portland": [45.5, -122.7],
  "sanjose": [37.3, -121.9],
  "siliconvalley": [37.4, -122.1],
  "sanfrancisco": [37.8, -122.4],
  "losangeles": [34.05, -118.2],
  "lasvegas": [36.2, -115.1],
  "phoenix": [33.4, -112.1],
  "denver": [39.7, -105.0],
  "dallas": [32.8, -96.8],
  "chicago": [41.9, -87.6],
  "atlanta": [33.75, -84.4],
  "miami": [25.8, -80.2],
  "ashburn": [39.0, -77.5],
  "newyork": [40.7, -74.0],
  "newark": [40.7, -74.2],
  "boston": [42.4, -71.1],
  "toronto": [43.65, -79.4],
  "montreal": [45.5, -73.6],
  "vancouver": [49.3, -123.1],
  "mexicocity": [19.4, -99.1],
  "saopaulo": [-23.55, -46.6],
  "santiago": [-33.45, -70.7],
  "buenosaires": [-34.6, -58.4],
  "johannesburg": [-26.2, 28.0],
  "capetown": [-33.9, 18.4],
  "lagos": [6.5, 3.4],
  "cairo": [30.0, 31.2],
}

const COUNTRIES: Record<string, [number, number]> = {
  "US": [39.8, -98.6],
  "CA": [56.1, -106.3],
  "MX": [23.6, -102.5],
  "BR": [-14.2, -51.9],
  "AR": [-38.4, -63.6],
  "CL": [-35.7, -71.5],
  "CO": [4.6, -74.1],
  "PE": [-9.2, -75.0],
  "GB": [54.0, -2.0],
  "IE": [53.4, -8.2],
  "FR": [46.6, 2.2],
  "DE": [51.2, 10.4],
  "NL": [52.1, 5.3],
  "BE": [50.5, 4.5],
  "CH": [46.8, 8.2],
  "AT": [47.5, 14.5],
  "IT": [42.8, 12.6],
  "ES": [40.2, -3.7],
  "PT": [39.6, -8.0],
  "SE": [62.0, 15.0],
  "NO": [61.0, 8.5],
  "FI": [64.0, 26.0],
  "DK": [56.0, 10.0],
  "PL": [52.0, 19.1],
  "CZ": [49.8, 15.5],
  "RO": [45.9, 25.0],
  "BG": [42.7, 25.5],
  "GR": [39.0, 22.0],
  "UA": [49.0, 31.4],
  "RU": [61.5, 99.0],
  "TR": [39.0, 35.2],
  "IL": [31.5, 34.9],
  "AE": [24.0, 54.0],
  "SA": [24.0, 45.0],
  "IN": [21.0, 78.0],
  "PK": [30.4, 69.3],
  "JP": [36.2, 138.3],
  "KR": [36.5, 127.9],
  "CN": [35.0, 103.8],
  "HK": [22.3, 114.2],
  "MO": [22.2, 113.5],
  "TW": [23.7, 121.0],
  "SG": [1.35, 103.8],
  "MY": [4.2, 102.0],
  "TH": [15.9, 101.0],
  "VN": [14.1, 108.3],
  "ID": [-2.5, 118.0],
  "PH": [12.9, 121.8],
  "KZ": [48.0, 67.0],
  "AU": [-25.3, 133.8],
  "NZ": [-41.0, 174.0],
  "ZA": [-29.0, 24.0],
  "EG": [26.8, 30.8],
  "NG": [9.1, 8.7],
  "KE": [0.0, 38.0],
  "MA": [31.8, -7.1],
  "LU": [49.8, 6.1],
  "LT": [55.2, 23.9],
  "LV": [56.9, 24.6],
  "EE": [58.6, 25.0],
  "IS": [64.9, -19.0],
  "HU": [47.2, 19.5],
  "RS": [44.0, 21.0],
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z]/g, "")
}

export function locateNode(node: { country_code?: string; name?: string }): GlobePosition | null {
  const name = normalize(String(node.name || ""))
  if (name) {
    let best = ""
    for (const city of Object.keys(CITIES)) {
      const key = normalize(city)
      if (key.length > best.length && name.includes(key)) best = city
    }
    if (best) return { lat: CITIES[best][0], lon: CITIES[best][1] }
  }
  const code = String(node.country_code || "").trim().toUpperCase()
  const country = COUNTRIES[code]
  return country ? { lat: country[0], lon: country[1] } : null
}

export function globeMarkers(nodes: GlobeNode[], limit = MAX_GLOBE_MARKERS): GlobeMarker[] {
  const byKey = new Map<string, GlobeMarker>()
  for (const node of nodes) {
    const pos = locateNode(node)
    if (!pos) continue
    const key = `${pos.lat},${pos.lon}`
    const marker = byKey.get(key) || { ...pos, key, total: 0, online: 0 }
    marker.total += 1
    if (node.online) marker.online += 1
    byKey.set(key, marker)
  }
  return [...byKey.values()].sort((a, b) => b.total - a.total).slice(0, Math.max(0, limit))
}

const RAD = Math.PI / 180

export function globeVector(lat: number, lon: number): [number, number, number] {
  return [Math.cos(lat * RAD) * Math.sin(lon * RAD), Math.sin(lat * RAD), Math.cos(lat * RAD) * Math.cos(lon * RAD)]
}
