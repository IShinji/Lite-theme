import GroupSwitch from "@/components/GroupSwitch"
import ServerCard from "@/components/ServerCard"
import ServerOverview from "@/components/ServerOverview"
import { Loader } from "@/components/loading/Loader"
import type { SortType } from "@/context/sort-context"
import { useStatus } from "@/hooks/use-status"
import { useWebSocketContext } from "@/hooks/use-websocket-context"
import { homeCardColumnCount, readHomeLatencyCache, writeHomeLatencyCache } from "@/lib/home-latency"
import { applyHomeProbeTaskOrder, homeProbeOverrideIds } from "@/lib/home-probe-tasks"
import { restoreHomeScroll, saveHomeScroll } from "@/lib/home-scroll"
import { fetchHomeLatency, fetchServerGroup } from "@/lib/lite-api"
import { compareHomeServers, readThemeHomeSort } from "@/lib/theme-home-sort"
import { readHomeProbeTaskOverrides } from "@/lib/theme-config"
import { formatLiteInfo, parseLiteWebsocketMessage } from "@/lib/utils"
import { ServerGroup } from "@/types/lite-api"
import { MenuItem, Select } from "@mui/material"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useLayoutEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

function homeLatencyStorage(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

const SORT_OPTION_KEYS: Array<{ value: SortType; labelKey: string }> = [
  { value: "default", labelKey: "home.sortDefault" },
  { value: "name", labelKey: "home.sortName" },
  { value: "cpu", labelKey: "home.sortLoad" },
  { value: "up", labelKey: "home.sortUpload" },
  { value: "down", labelKey: "home.sortDownload" },
]

function useHomeCardColumns() {
  const [columns, setColumns] = useState(() => (typeof window === "undefined" ? 1 : homeCardColumnCount(window.innerWidth)))
  useLayoutEffect(() => {
    const update = () => setColumns(homeCardColumnCount(window.innerWidth))
    update()
    window.addEventListener("resize", update)
    return () => window.removeEventListener("resize", update)
  }, [])
  return columns
}

export default function Servers() {
  const { t } = useTranslation()
  const { status } = useStatus()
  const { lastMessage, connected } = useWebSocketContext()
  const cardColumns = useHomeCardColumns()
  const [currentGroup, setCurrentGroup] = useState("All")
  const themeSort = readThemeHomeSort()
  const [sortType, setSortType] = useState<SortType>(themeSort.sortType)
  const sortOrder = themeSort.sortOrder
  const { data: groupData } = useQuery({
    queryKey: ["server-group"],
    queryFn: () => fetchServerGroup(),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })
  const websocketData = parseLiteWebsocketMessage(lastMessage?.data)
  const latencyEntityKey = useMemo(
    () =>
      (websocketData?.servers || [])
        .map((server) => server.uuid)
        .filter((uuid): uuid is string => Boolean(uuid))
        .sort()
        .join(","),
    [websocketData?.servers],
  )
  const latencyEntityIds = latencyEntityKey ? latencyEntityKey.split(",") : []
  const { data: homeLatency = {} } = useQuery({
    queryKey: ["home-latency", latencyEntityKey],
    queryFn: async () => {
      const data = await fetchHomeLatency(latencyEntityIds)
      writeHomeLatencyCache(homeLatencyStorage(), data)
      return data
    },
    placeholderData: () => readHomeLatencyCache(homeLatencyStorage(), latencyEntityIds),
    enabled: latencyEntityIds.length > 0,
    staleTime: 5_000,
    refetchInterval: 5_000,
    refetchOnWindowFocus: false,
  })

  useLayoutEffect(() => {
    restoreHomeScroll()
    const timers = [50, 120, 250].map((ms) => window.setTimeout(() => restoreHomeScroll(), ms))
    return () => timers.forEach((id) => window.clearTimeout(id))
  }, [])

  useEffect(() => {
    setCurrentGroup(sessionStorage.getItem("selectedGroup") || "All")
  }, [])

  useEffect(() => {
    let ticking = false
    let armed = false
    const armTimer = window.setTimeout(() => {
      armed = true
    }, 300)
    const persist = () => {
      ticking = false
      if (!armed) return
      saveHomeScroll()
    }
    const onScroll = () => {
      if (ticking) return
      ticking = true
      window.requestAnimationFrame(persist)
    }
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      armed = false
      window.clearTimeout(armTimer)
      window.removeEventListener("scroll", onScroll)
    }
  }, [])

  const handleGroupChange = (group: string) => {
    setCurrentGroup(group)
    sessionStorage.setItem("selectedGroup", group)
  }

  if (!connected && !lastMessage) {
    return <Loader visible />
  }

  if (!websocketData) {
    return <p className="py-20 text-center text-sm text-muted-foreground">{t("info.processing")}</p>
  }

  const groupTabs = [
    "All",
    ...(groupData?.data
      ?.filter((item: ServerGroup) => item.servers?.some((serverId) => websocketData.servers.some((server) => server.id === serverId)))
      .map((item: ServerGroup) => item.group.name) || []),
  ]
  const groupedServers = websocketData.servers.filter((server) => {
    if (currentGroup === "All") return true
    return groupData?.data?.some((group: ServerGroup) => group.group.name === currentGroup && group.servers?.includes(server.id))
  })
  const totalServers = groupedServers.length
  const onlineServers = groupedServers.filter((server) => formatLiteInfo(websocketData.now, server).online).length
  const offlineServers = totalServers - onlineServers
  const onlineOnly = groupedServers.filter((server) => formatLiteInfo(websocketData.now, server).online)
  const up = onlineOnly.reduce((total, server) => total + (server.state?.net_out_transfer || 0), 0)
  const down = onlineOnly.reduce((total, server) => total + (server.state?.net_in_transfer || 0), 0)
  const upSpeed = onlineOnly.reduce((total, server) => total + ((server.state?.net_out_speed || 0) / 1000 / 1000), 0)
  const downSpeed = onlineOnly.reduce((total, server) => total + ((server.state?.net_in_speed || 0) / 1000 / 1000), 0)
  const regionServers = groupedServers.map((server) => {
    const info = formatLiteInfo(websocketData.now, server)
    return { country_code: info.country_code, online: info.online, cpu: info.cpu, mem: info.mem, tcp: info.tcp, udp: info.udp, cpu_cores: info.cpu_cores, mem_total: info.mem_total, mem_used: server.state?.mem_used || 0, disk_total: info.disk_total, disk_used: server.state?.disk_used || 0 }
  })
  const statusFiltered =
    status === "all"
      ? groupedServers
      : groupedServers.filter((server) => (formatLiteInfo(websocketData.now, server).online ? "online" : "offline") === status)
  const filteredServers = [...statusFiltered].sort((a, b) => compareHomeServers(a, b, websocketData.now, sortType, sortOrder))
  const probeOverrides = readHomeProbeTaskOverrides()
  const latencyFor = (uuid?: string) =>
    applyHomeProbeTaskOrder(uuid ? homeLatency[uuid] || [] : [], homeProbeOverrideIds(probeOverrides, uuid || ""))
  return (
    <div className="w-full">
      <ServerOverview
        total={totalServers}
        online={onlineServers}
        offline={offlineServers}
        up={up}
        down={down}
        upSpeed={upSpeed}
        downSpeed={downSpeed}
        now={websocketData.now}
        servers={regionServers}
      />
      <section className="mb-4 mt-2 flex items-center justify-between gap-3 max-[967px]:mt-2 max-[967px]:grid max-[967px]:grid-cols-[minmax(0,1fr)_auto] max-[967px]:items-center max-[967px]:gap-x-2.5 max-[967px]:gap-y-2.5" aria-label={t("home.filter")}>
        <div className="flex min-w-0 items-center gap-3 max-[967px]:contents">
          <div className="flex items-end gap-2.5 max-[967px]:col-start-1 max-[967px]:row-start-1">
            <h2 className="m-0 text-lg font-semibold leading-none text-[#1C252E] dark:text-white">{t("home.allServers")}</h2>
            <span className="text-[11px] leading-none text-[#919EAB]">{t("home.serverCount", { count: filteredServers.length })}</span>
          </div>
          <div className="min-w-0 max-[967px]:col-span-2 max-[967px]:row-start-2">
            <GroupSwitch tabs={groupTabs} currentTab={currentGroup} setCurrentTab={handleGroupChange} />
          </div>
        </div>
        <Select
          size="small"
          value={sortType}
          onChange={(event) => setSortType(event.target.value as SortType)}
          aria-label={t("home.sort")}
          sx={{ minWidth: 112, height: 32, fontSize: 11, flexShrink: 0, ".MuiSelect-select": { py: 0.75 } }}
        >
          {SORT_OPTION_KEYS.map((option) => (
            <MenuItem key={option.value} value={option.value}>{t(option.labelKey)}</MenuItem>
          ))}
        </Select>
      </section>
      <section
        className="grid items-stretch gap-4"
        style={{ gridTemplateColumns: `repeat(${cardColumns}, minmax(0, 1fr))` }}
        aria-label="Server list"
      >
        {filteredServers.map((serverInfo) => (
          <ServerCard
            now={websocketData.now}
            key={serverInfo.id}
            serverInfo={serverInfo}
            latencySummaries={latencyFor(serverInfo.uuid)}
          />
        ))}
      </section>
    </div>
  )
}
