import { NetworkChart } from "@/components/NetworkChart"
import ServerDetailChart from "@/components/ServerDetailChart"
import ServerDetailOverview from "@/components/ServerDetailOverview"
import { applyServerDetailTabParams, isNetworkView, parsePingTaskId, resolveServerRouteId } from "@/lib/server-route"
import { cn } from "@/lib/utils"
import { useEffect, useLayoutEffect, useState } from "react"
import { Navigate, useParams, useSearchParams } from "react-router-dom"

const tabs = ["Detail", "Network"]

export default function ServerDetail() {
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" })
  }, [])

  const { id: routeId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const pingTaskId = parsePingTaskId(searchParams.get("ping_task"))
  const openNetworkView = isNetworkView(searchParams.get("view")) || pingTaskId !== undefined
  const serverId = routeId ? resolveServerRouteId(routeId) : null
  const [currentTab, setCurrentTab] = useState(openNetworkView ? tabs[1] : tabs[0])

  useEffect(() => {
    setCurrentTab(openNetworkView ? tabs[1] : tabs[0])
  }, [openNetworkView, routeId])

  const selectTab = (tab: string) => {
    setCurrentTab(tab)
    const next = applyServerDetailTabParams(searchParams, tab === tabs[1])
    if (next.get("view") === searchParams.get("view") && next.get("ping_task") === searchParams.get("ping_task")) return
    setSearchParams(next, { replace: true })
  }

  if (serverId === null) return <Navigate to="/404" replace />

  return (
    <div className="mx-auto flex w-full max-w-[1920px] flex-col gap-2 px-0 server-info">
      <section className="lite-detail-head">
        <ServerDetailOverview
          server_id={serverId}
          tabs={tabs}
          currentTab={currentTab}
          setCurrentTab={selectTab}
        />
      </section>
      <div className="relative w-full overflow-hidden">
        <div
          aria-hidden={currentTab !== tabs[0]}
          data-testid="server-detail-panel"
          className={cn("w-full transition-opacity duration-200 ease-out motion-reduce:transition-none", currentTab === tabs[0] ? "relative opacity-100" : "pointer-events-none absolute inset-x-0 top-0 overflow-hidden opacity-0")}
        >
          <ServerDetailChart server_id={serverId} show={currentTab === tabs[0]} />
        </div>
        <div
          aria-hidden={currentTab !== tabs[1]}
          data-testid="server-network-panel"
          className={cn("w-full transition-opacity duration-200 ease-out motion-reduce:transition-none", currentTab === tabs[1] ? "relative opacity-100" : "pointer-events-none absolute inset-x-0 top-0 overflow-hidden opacity-0")}
        >
          <NetworkChart key={`${serverId}-${pingTaskId ?? "all"}`} server_id={serverId} show={currentTab === tabs[1]} initialMonitorId={pingTaskId} />
        </div>
      </div>
    </div>
  )
}
