import ServerFlag from "@/components/ServerFlag"
import { useWebSocketContext } from "@/hooks/use-websocket-context"
import { GetOsName } from "@/lib/logo-class"
import { isNetworkView } from "@/lib/server-route"
import { SERVER_TAG_TONE, type ServerTagColor } from "@/lib/server-tags"
import { serverBandwidthLabel } from "@/lib/theme-config"
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

function MetaBadge({ text, color }: { text: string; color: ServerTagColor }) {
  const tone = SERVER_TAG_TONE[color]
  return (
    <span
      className="whitespace-nowrap rounded-[6px] px-[7px] py-0.5 text-[10px] font-medium [background:var(--tag-bg)] [color:var(--tag-fg)] dark:[background:var(--tag-dark-bg)] dark:[color:var(--tag-dark-fg)]"
      style={{
        ["--tag-bg" as string]: tone.bg,
        ["--tag-fg" as string]: tone.fg,
        ["--tag-dark-bg" as string]: tone.darkBg,
        ["--tag-dark-fg" as string]: tone.darkFg,
      }}
    >
      {text}
    </span>
  )
}

function ServerJumpMenu({ currentId, servers, keepNetwork }: { currentId: number; servers: LiteServer[]; keepNetwork: boolean }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const items = useMemo(
    () =>
      [...servers].sort((a, b) => {
        const aOnline = a.online === true
        const bOnline = b.online === true
        if (aOnline !== bOnline) return aOnline ? -1 : 1
        const index = (a.display_index || 0) - (b.display_index || 0)
        return index !== 0 ? index : a.name.localeCompare(b.name)
      }),
    [servers],
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
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        slotProps={{ paper: { sx: { width: 280, maxHeight: 360, mt: 0.75 } } }}
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
    <div className="flex shrink-0 items-center gap-1.5">
      <span className={online ? "inline-flex items-center gap-1.5 text-[11px] text-[#118D57] dark:text-[#61C8A5]" : "inline-flex items-center gap-1.5 text-[11px] text-[#B71D18] dark:text-[#F18C84]"}>
        <i className={online ? "size-1.5 rounded-full bg-[#22C55E]" : "size-1.5 rounded-full bg-[#FF5630]"} />
        <span className="max-[420px]:sr-only">{online ? t("online") : t("offline")}</span>
      </span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="inline-flex h-7 items-center gap-1 rounded-[6px] border border-[var(--lite-line)] bg-[var(--lite-soft)] px-2 text-[11px] text-[#637381] hover:text-[#078DEE] max-[620px]:w-7 max-[620px]:justify-center max-[620px]:px-0"
        aria-label={t("serverDetail.refresh")}
      >
        <RefreshCw className="size-3.5" />
        <span className="max-[620px]:hidden">{t("serverDetail.refresh")}</span>
      </button>
    </div>
  )
}

export default function ServerDetailOverview({ server_id }: { server_id: number }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { lastMessage, connected } = useWebSocketContext()

  if (!connected && !lastMessage) {
    return (
      <div className="flex h-[52px] items-center gap-3 px-4">
        <button type="button" onClick={() => navigate("/")} className="inline-flex size-8 shrink-0 items-center justify-center rounded-[6px] text-[#637381] hover:bg-[var(--lite-soft)] hover:text-[#078DEE]" aria-label={t("serverDetail.backToList")}>
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
      <div className="flex h-[52px] items-center gap-3 px-4">
        <button type="button" onClick={() => navigate("/")} className="inline-flex size-8 shrink-0 items-center justify-center rounded-[6px] text-[#637381] hover:bg-[var(--lite-soft)] hover:text-[#078DEE]" aria-label={t("serverDetail.backToList")}>
          <ArrowLeft className="size-[17px]" />
        </button>
        <span className="h-5 w-36 rounded-[6px] bg-[var(--lite-soft)]" />
      </div>
    )
  }

  const info = formatLiteInfo(websocketData.now, server)
  const os = systemName(info.platform)
  const bandwidth = serverBandwidthLabel(server.bandwidth)
  const badges = (
    <>
      {os ? <MetaBadge text={os} color="teal" /> : null}
      {info.arch ? <MetaBadge text={info.arch} color="violet" /> : null}
      {bandwidth ? <MetaBadge text={bandwidth} color="amber" /> : null}
    </>
  )

  return (
    <div className="px-4 py-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <button
          type="button"
          onClick={() => navigate("/")}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-[6px] text-[#637381] transition-colors hover:bg-[var(--lite-soft)] hover:text-[#078DEE]"
          aria-label={t("serverDetail.backToList")}
        >
          <ArrowLeft className="size-[17px]" />
        </button>
        <ServerFlag className="max-[620px]:h-[15px] max-[620px]:w-[22px]" size="lg" country_code={info.country_code} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="min-w-0 truncate text-[18px] font-semibold leading-none text-[#1C252E] dark:text-white">{info.name}</h1>
            <ServerJumpMenu currentId={server.id} servers={websocketData.servers} keepNetwork={isNetworkView(searchParams.get("view"))} />
            <div className="hidden min-w-0 flex-wrap items-center gap-1.5 min-[621px]:flex">{badges}</div>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 min-[621px]:hidden">{badges}</div>
        </div>
        <StatusActions online={info.online} />
      </div>
    </div>
  )
}
