import ServerFlag from "@/components/ServerFlag"
import TabSwitch from "@/components/TabSwitch"
import { useWebSocketContext } from "@/hooks/use-websocket-context"
import { GetOsName } from "@/lib/logo-class"
import { isNetworkView } from "@/lib/server-route"
import { serverBandwidthLabel } from "@/lib/theme-config"
import { compareHomeServers, readThemeHomeSort } from "@/lib/theme-home-sort"
import { cn, formatLiteInfo, parseLiteWebsocketMessage } from "@/lib/utils"
import type { LiteServer } from "@/types/lite-api"
import { ListItemIcon, ListItemText, ListSubheader, Menu, MenuItem } from "@mui/material"
import { ArrowLeft, Check, ChevronDown, RefreshCw } from "lucide-react"
import { useMemo, useState, type MouseEvent } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate, useSearchParams } from "react-router-dom"

function systemName(platform: string) {
  return platform.toLowerCase().includes("windows") ? "Windows" : GetOsName(platform)
}

function ServerJumpMenu({ currentId, servers, now, keepNetwork }: { currentId: number; servers: LiteServer[]; now: number; keepNetwork: boolean }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const { sortType, sortOrder } = readThemeHomeSort()
  const items = useMemo(
    () => [...servers].sort((a, b) => compareHomeServers(a, b, now, sortType, sortOrder)),
    [servers, now, sortType, sortOrder],
  )

  if (items.length < 2) return null

  const jump = (server: LiteServer) => {
    setAnchor(null)
    if (server.id === currentId) return
    const path = `/server/${server.uuid || server.id}`
    navigate(keepNetwork ? `${path}?view=network` : path)
  }

  return (
    <>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={Boolean(anchor)}
        aria-label={t("serverDetail.switchServer")}
        onClick={(event: MouseEvent<HTMLButtonElement>) => setAnchor(event.currentTarget)}
        className={cn(
          "inline-flex size-6 items-center justify-center rounded-[6px] text-[#637381] transition-colors hover:bg-[var(--lite-soft)] hover:text-[#078DEE]",
          anchor && "bg-[var(--lite-soft)] text-[#078DEE]",
        )}
      >
        <ChevronDown className={cn("size-4 transition-transform", anchor && "rotate-180")} />
      </button>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        disableScrollLock
        disableAutoFocus
        disableRestoreFocus
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        slotProps={{
          paper: { sx: { width: 280, maxHeight: 360, mt: 0.75 } },
          list: { autoFocusItem: false },
        }}
      >
        <ListSubheader disableSticky sx={{ lineHeight: "28px", px: 1.25, pb: 0.5, fontSize: 11, fontWeight: 600, color: "text.secondary", bgcolor: "transparent" }}>
          {t("serverDetail.switchServer")}
        </ListSubheader>
        {items.map((server) => {
          const selected = server.id === currentId
          return (
            <MenuItem key={server.id} selected={selected} onClick={() => jump(server)} sx={{ gap: 1.25, py: 0.75, px: 1.25 }}>
              <ServerFlag country_code={server.country_code} />
              <ListItemText primary={server.name} slotProps={{ primary: { noWrap: true, sx: { fontSize: 13, fontWeight: 500 } } }} />
              <span className={cn("shrink-0 text-[10px] font-medium", server.online ? "text-[#118D57] dark:text-[#61C8A5]" : "text-[#B71D18] dark:text-[#F18C84]")}>
                {server.online ? t("online") : t("offline")}
              </span>
              {selected ? (
                <ListItemIcon sx={{ minWidth: 0 }}>
                  <Check className="size-3.5 text-[#078DEE]" />
                </ListItemIcon>
              ) : null}
            </MenuItem>
          )
        })}
      </Menu>
    </>
  )
}

function StatusActions({ online }: { online: boolean }) {
  const { t } = useTranslation()
  return (
    <div className="lite-server-head__actions">
      <span className={cn("lite-server-head__status", online ? "is-online" : "is-offline")}>
        <i />
        <span>{online ? t("online") : t("offline")}</span>
      </span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="lite-server-head__refresh"
        aria-label={t("serverDetail.refresh")}
      >
        <RefreshCw className="size-3.5" />
        <span>{t("serverDetail.refresh")}</span>
      </button>
    </div>
  )
}

export default function ServerDetailOverview({
  server_id,
  tabs,
  currentTab,
  setCurrentTab,
}: {
  server_id: number
  tabs: string[]
  currentTab: string
  setCurrentTab: (tab: string) => void
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { lastMessage, connected } = useWebSocketContext()

  if (!connected && !lastMessage) {
    return (
      <div className="lite-server-head lite-server-head--pending">
        <button type="button" onClick={() => navigate("/")} className="lite-server-head__back" aria-label={t("serverDetail.backToList")}>
          <ArrowLeft className="size-[17px]" />
        </button>
        <span className="h-5 w-36 rounded-[6px] bg-[var(--lite-soft)]" />
      </div>
    )
  }

  const websocketData = parseLiteWebsocketMessage(lastMessage?.data)
  const server = websocketData?.servers.find((item) => item.id === server_id)
  if (!websocketData || !server) {
    return (
      <div className="lite-server-head lite-server-head--pending">
        <button type="button" onClick={() => navigate("/")} className="lite-server-head__back" aria-label={t("serverDetail.backToList")}>
          <ArrowLeft className="size-[17px]" />
        </button>
        <span className="h-5 w-36 rounded-[6px] bg-[var(--lite-soft)]" />
      </div>
    )
  }

  const info = formatLiteInfo(websocketData.now, server)
  const os = systemName(info.platform)
  const bandwidth = serverBandwidthLabel(server.bandwidth)
  const meta = [os, info.arch, bandwidth].filter(Boolean).join(" · ")

  return (
    <div className="lite-server-head">
      <div className="lite-server-head__identity flex min-w-0 items-center gap-2.5">
        <button
          type="button"
          onClick={() => navigate("/")}
          className="lite-server-head__back"
          aria-label={t("serverDetail.backToList")}
        >
          <ArrowLeft className="size-[17px]" />
        </button>
        <ServerFlag className="max-[620px]:h-[15px] max-[620px]:w-[22px]" size="lg" country_code={info.country_code} />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="min-w-0 truncate text-[23px] font-semibold leading-[27px] tracking-[-0.6px] text-[#1C252E] dark:text-white max-[967px]:text-[16px] max-[967px]:leading-[22px] max-[967px]:tracking-[-0.35px]">{info.name}</h1>
            <ServerJumpMenu currentId={server.id} servers={websocketData.servers} now={websocketData.now} keepNetwork={isNetworkView(searchParams.get("view"))} />
          </div>
          {meta ? <p className="lite-server-head__meta">{meta}</p> : null}
        </div>
      </div>
      <TabSwitch tabs={tabs} currentTab={currentTab} setCurrentTab={setCurrentTab} />
      <StatusActions online={info.online} />
    </div>
  )
}
