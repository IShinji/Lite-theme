// 区域快捷按钮（全球 / 北美 / 东亚…）：平面地图和地球仪共用；只显示有节点的区域，由调用方传入。
type Props = { regions: Array<{ key: string; label: string }>; active: string; onPick: (key: string) => void }

export default function RegionChips({ regions, active, onPick }: Props) {
  return (
    <div className="segmented" role="group" aria-label="地图区域">
      {[{ key: "world", label: "全球" }, ...regions].map((r) => (
        <button key={r.key} className={active === r.key ? "chosen" : ""} aria-pressed={active === r.key} onClick={() => onPick(r.key)}>
          {r.label}
        </button>
      ))}
    </div>
  )
}
