import { filterTasksByName } from "@/lib/probe-task-picker"
import { cn } from "@/lib/utils"
import { Checkbox, Drawer, Popover, useMediaQuery } from "@mui/material"
import { Search } from "lucide-react"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"

type NetworkTaskPickerProps = {
  open: boolean
  anchorEl: HTMLElement | null
  names: string[]
  delays: Record<string, string>
  draft: string[]
  query: string
  onQuery: (value: string) => void
  onToggle: (name: string) => void
  onSelectResults: () => void
  onClear: () => void
  onApply: () => void
  onClose: () => void
}

function PickerBody({
  names,
  delays,
  draft,
  query,
  onQuery,
  onToggle,
  onSelectResults,
  onClear,
  onApply,
  onClose,
  phone,
}: Omit<NetworkTaskPickerProps, "open" | "anchorEl"> & { phone: boolean }) {
  const { t } = useTranslation()
  const visible = useMemo(() => filterTasksByName(names, query), [names, query])

  return (
    <div className={cn("lite-task-picker", phone && "lite-task-picker--sheet")}>
      <header className="lite-task-picker__head">
        <h2 id="lite-task-picker-title">{t("monitor.selectTasks")}</h2>
        <p>{t("monitor.selectedRatio", { selected: draft.length, total: names.length })}</p>
      </header>
      <div className="lite-task-picker__body">
        <label className="lite-task-picker__search">
          <Search className="size-3.5" aria-hidden="true" />
          <span className="lite-task-picker__field">
            <input
              type="text"
              value={query}
              onChange={(event) => onQuery(event.target.value)}
              aria-label={t("monitor.searchTaskName")}
              autoComplete="off"
              autoFocus={false}
              spellCheck={false}
            />
            {query ? null : (
              <span className="lite-task-picker__hint" aria-hidden="true">{t("monitor.searchTaskName")}</span>
            )}
          </span>
        </label>
        <div className="lite-task-picker__list" role="listbox" aria-multiselectable="true" aria-labelledby="lite-task-picker-title">
          {visible.length > 0 ? visible.map((name) => {
            const selected = draft.includes(name)
            return (
              <label key={name} className={cn("lite-task-picker__item", selected && "is-selected")}>
                <Checkbox
                  size="small"
                  checked={selected}
                  onChange={() => onToggle(name)}
                  slotProps={{ input: { "aria-label": name } }}
                  sx={{ p: 0, flex: "none" }}
                />
                <span className="lite-task-picker__name">{name}</span>
                <span className="lite-task-picker__delay">{delays[name] || "--"}</span>
              </label>
            )
          }) : (
            <p className="lite-task-picker__empty">{t("monitor.noTaskMatch")}</p>
          )}
        </div>
      </div>
      <footer className="lite-task-picker__foot">
        <div className="lite-task-picker__actions">
          <button type="button" onClick={onSelectResults}>{t("monitor.selectAllResults")}</button>
          <button type="button" onClick={onClear}>{t("monitor.clearSelected")}</button>
        </div>
        <div className="lite-task-picker__confirm">
          <button type="button" onClick={onClose}>{t("common.cancel")}</button>
          <button type="button" className="is-primary" disabled={draft.length === 0} onClick={onApply}>
            {t("monitor.applySelection")}
          </button>
        </div>
      </footer>
    </div>
  )
}

export default function NetworkTaskPicker(props: NetworkTaskPickerProps) {
  const { t } = useTranslation()
  const phone = useMediaQuery("(max-width: 967px)")
  const body = <PickerBody {...props} phone={phone} />

  if (phone) {
    return (
      <Drawer
        anchor="bottom"
        open={props.open}
        onClose={props.onClose}
        ModalProps={{ keepMounted: false }}
        slotProps={{
          paper: {
            className: "lite-task-picker-sheet",
            "aria-labelledby": "lite-task-picker-title",
          },
        }}
      >
        {body}
      </Drawer>
    )
  }

  return (
    <Popover
      open={props.open}
      anchorEl={props.anchorEl}
      onClose={props.onClose}
      disableScrollLock
      disableAutoFocus
      disableRestoreFocus={false}
      anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      transformOrigin={{ vertical: "top", horizontal: "left" }}
      slotProps={{
        paper: {
          className: "lite-task-picker-pop",
          "aria-label": t("monitor.selectTasks"),
        },
      }}
    >
      {body}
    </Popover>
  )
}
