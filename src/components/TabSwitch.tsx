import { Activity, LayoutDashboard } from "lucide-react"
import { useTranslation } from "react-i18next"

export default function TabSwitch({ tabs, currentTab, setCurrentTab }: { tabs: string[]; currentTab: string; setCurrentTab: (tab: string) => void }) {
  const { t } = useTranslation()

  return (
    <div role="tablist" aria-label={t("serverDetail.viewTabs")} className="flex w-full justify-center gap-1 border-t border-[var(--lite-line)] px-2 py-2 max-[620px]:px-1.5">
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
            className={`inline-flex h-8 min-w-[112px] items-center justify-center gap-1.5 rounded-[6px] px-3 text-[11px] font-medium transition-colors max-[620px]:min-w-0 max-[620px]:flex-1 ${selected ? "bg-[rgba(7,141,238,.10)] text-[#078DEE]" : "text-[#637381] hover:bg-[var(--lite-soft)] dark:text-[#C4CDD5]"}`}
          >
            <Icon className="size-4" />
            {t(`tabSwitch.${tab}`)}
          </button>
        )
      })}
    </div>
  )
}
