// world-atlas 的 JSON 很大，让 TypeScript 去推断它的类型会很慢；这里声明成 unknown，使用处自己断言成 Topology。
declare module "world-atlas/countries-110m.json" {
  const topology: unknown
  export default topology
}
declare module "world-atlas/countries-50m.json" {
  const topology: unknown
  export default topology
}
