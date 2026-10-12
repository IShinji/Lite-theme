import { cn } from "@/lib/utils"
import { Activity, LayoutDashboard } from "lucide-react"
import { useTranslation } from "react-i18next"

export default function TabSwitch({
  tabs,
  currentTab,
  setCurrentTab,
  className,
}: {
  tabs: string[]
  currentTab: string
  setCurrentTab: (tab: string) => void
  className?: string
}) {
  const { t } = useTranslation()

  return (
    <div role="tablist" aria-label={t("serverDetail.viewTabs")} className={cn("lite-page-tabs", className)}>
      {tabs.map((tab) => {
        const Icon = tab === "Network" ? Activity : LayoutDashboard
        const selected = currentTab === tab
        return (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => setCurrentTab(tab)}
            className={cn("lite-page-tabs__item", selected && "is-active")}
          >
            <Icon className="size-3.5" />
            {t(`tabSwitch.${tab}`)}
          </button>
        )
      })}
    </div>
  )
}
