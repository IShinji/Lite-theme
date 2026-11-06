// 世界地理数据（Natural Earth，来自 world-atlas）：矢量海岸线 / 国界，以及从中栅格出来的陆地掩膜。只在浏览器里按需加载一次。
// 缩小时用 110m（点少、画得快），放大后换 50m（海岸线更细）；陆地点阵始终从 50m 的掩膜里采样。
import { geoEquirectangular, geoPath, type GeoPermissibleObjects } from "d3-geo"
import { feature, mesh } from "topojson-client"
import type { GeometryCollection, Topology } from "topojson-specification"

import type { LandMask } from "./world-dots.ts"

/** land 用来填色；coast 是海岸线折线、borders 是国界折线，用来描边（折线不会像多边形轮廓那样在球的边缘多画一圈）。 */
export type WorldLayer = { land: GeoPermissibleObjects; coast: GeoPermissibleObjects; borders: GeoPermissibleObjects }
export type World = { coarse: WorldLayer; fine: WorldLayer; mask: LandMask }

/** 掩膜分辨率：每度 8 像素（0.125 度一格），够最细的点距档（0.21 度）用。 */
const MASK_W = 2880
const MASK_H = 1440

const layer = (topology: Topology): WorldLayer => ({
  land: feature(topology, topology.objects.land as GeometryCollection),
  coast: mesh(topology, topology.objects.land as GeometryCollection),
  borders: mesh(topology, topology.objects.countries as GeometryCollection, (a, b) => a !== b),
})

/** 把陆地多边形画到等距圆柱投影的离屏画布上，取 alpha 通道作为陆地掩膜。 */
function rasterize(land: GeoPermissibleObjects): LandMask {
  const canvas = document.createElement("canvas")
  canvas.width = MASK_W
  canvas.height = MASK_H
  const ctx = canvas.getContext("2d", { willReadFrequently: true })
  if (!ctx) return { w: MASK_W, h: MASK_H, data: new Uint8Array(MASK_W * MASK_H) }
  const projection = geoEquirectangular()
    .scale(MASK_W / (2 * Math.PI))
    .translate([MASK_W / 2, MASK_H / 2])
    .precision(0.1)
  ctx.fillStyle = "#000"
  ctx.beginPath()
  geoPath(projection, ctx)(land)
  ctx.fill()
  const rgba = ctx.getImageData(0, 0, MASK_W, MASK_H).data
  const data = new Uint8Array(MASK_W * MASK_H)
  for (let i = 0; i < data.length; i++) data[i] = rgba[i * 4 + 3]
  return { w: MASK_W, h: MASK_H, data }
}

let pending: Promise<World> | null = null

export function loadWorld(): Promise<World> {
  if (!pending) {
    pending = Promise.all([import("world-atlas/countries-110m.json"), import("world-atlas/countries-50m.json")]).then(([coarse, fine]) => {
      const c = layer(coarse.default as Topology)
      const f = layer(fine.default as Topology)
      return { coarse: c, fine: f, mask: rasterize(f.land) }
    })
    pending.catch(() => {
      pending = null
    })
  }
  return pending
}
