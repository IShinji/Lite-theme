import { countFittingChips } from "@/lib/fit-chips"
import { cn } from "@/lib/utils"
import { useLayoutEffect, useRef, useState, type MouseEvent } from "react"

export default function FitTaskChips({
  names,
  colorOf,
  extraLabel,
  selectedNames,
  onSelect,
  onMore,
}: {
  names: string[]
  colorOf: (name: string) => string
  extraLabel: (count: number) => string
  selectedNames?: readonly string[]
  onSelect?: (name: string) => void
  onMore: (event: MouseEvent<HTMLButtonElement>) => void
}) {
  const selected = new Set(selectedNames)
  const rowRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const moreRef = useRef<HTMLSpanElement>(null)
  const [visible, setVisible] = useState(names.length)

  useLayoutEffect(() => {
    const row = rowRef.current
    const measure = measureRef.current
    if (!row || !measure) return

    const fit = () => {
      const chips = [...measure.querySelectorAll<HTMLElement>("[data-chip]")]
      const styles = getComputedStyle(measure)
      const gap = Number.parseFloat(styles.columnGap || styles.gap) || 8
      const moreWidth = moreRef.current?.offsetWidth || 44
      const count = countFittingChips(
        chips.map((chip) => chip.offsetWidth),
        row.clientWidth,
        gap,
        moreWidth,
      )
      setVisible(count)
    }

    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(row)
    return () => observer.disconnect()
  }, [names])

  const shown = names.slice(0, visible)
  const extra = names.length - shown.length

  return (
    <div ref={rowRef} className="lite-task-chips">
      <div ref={measureRef} className="lite-task-chips__measure" aria-hidden="true">
        {names.map((name) => (
          <span key={name} data-chip className="lite-task-chips__item">
            <i className="lite-task-dot" style={{ backgroundColor: colorOf(name) }} />
            <span>{name}</span>
          </span>
        ))}
        <span ref={moreRef} className="lite-task-chips__more">+99</span>
      </div>
      {shown.map((name) => (
        <button
          key={name}
          type="button"
          className={cn("lite-task-chips__item", selected.has(name) && "is-active")}
          title={name}
          aria-pressed={selected.has(name)}
          onClick={() => onSelect?.(name)}
        >
          <i className="lite-task-dot" style={{ backgroundColor: colorOf(name) }} />
          <span className="min-w-0 truncate">{name}</span>
        </button>
      ))}
      {extra > 0 ? (
        <button type="button" className="lite-task-chips__more" onClick={onMore}>
          {extraLabel(extra)}
        </button>
      ) : null}
    </div>
  )
}
