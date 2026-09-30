import { LanguageSwitcher } from "@/components/LanguageSwitcher"
import { ModeToggle } from "@/components/ThemeSwitcher"
import { Skeleton } from "@/components/ui/skeleton"
import { useSiteLogo } from "@/hooks/use-site-logo"
import { fetchAccount, fetchSetting } from "@/lib/lite-api"
import { clearHomeScroll } from "@/lib/home-scroll"
import { LITE_BLUE, LITE_BLUE_HOVER } from "@/theme/brand"
import { useQuery } from "@tanstack/react-query"
import { Avatar, Button, IconButton } from "@mui/material"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"

function Header() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const customLogo = useSiteLogo()
  const { data: settingData, isLoading } = useQuery({
    queryKey: ["setting"],
    queryFn: () => fetchSetting(),
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  })
  const { data: account } = useQuery({
    queryKey: ["me"],
    queryFn: fetchAccount,
    refetchOnWindowFocus: true,
    staleTime: 15_000,
  })
  const siteName = settingData?.data?.config?.site_name || "Lite"
  const siteDesc = settingData?.data?.config?.site_desc || ""
  const loggedIn = account?.logged_in === true
  const username = account?.username?.trim() || ""
  const avatarUrl = account?.avatar_url || ""

  return (
    <header className="lite-page-header fixed inset-x-0 top-0 z-30 border-b border-[var(--lite-line)] bg-white/96 pt-[var(--safe-area-top)] h-[calc(var(--lite-header-height)+var(--safe-area-top))] backdrop-blur-sm dark:bg-[#1C2838]/97">
      <div className="lite-page-shell flex h-full items-center gap-3 max-[967px]:gap-2.5">
        <button
          type="button"
          onClick={() => {
            sessionStorage.removeItem("selectedGroup")
            clearHomeScroll()
            navigate("/")
          }}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left max-[967px]:gap-2"
        >
          <img className="size-[31px] shrink-0 rounded-lg object-cover max-[967px]:size-[27px]" alt="site logo" src={customLogo} width={31} height={31} />
          <span className="flex min-w-0 flex-1 items-center gap-2.5 max-[967px]:gap-2.5">
            {isLoading ? (
              <Skeleton className="h-5 w-40 rounded-md" />
            ) : (
              <>
                <span className="max-w-[38%] shrink-0 truncate text-2xl font-bold leading-none tracking-tight text-[#1C252E] dark:text-white max-[967px]:max-w-[34%] max-[967px]:text-xl sm:max-w-[280px]">
                  {siteName}
                </span>
                {siteDesc ? (
                  <>
                    <span className="h-4 w-px shrink-0 self-center bg-[var(--lite-line)] sm:h-5" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate whitespace-nowrap text-[13px] leading-5 text-[#637381] max-[967px]:text-[10px] max-[967px]:leading-5">
                      {siteDesc}
                    </span>
                  </>
                ) : null}
              </>
            )}
          </span>
        </button>
        <nav className="flex shrink-0 items-center gap-1.5 max-[967px]:gap-0.5" aria-label="Public dashboard actions">
          <LanguageSwitcher />
          <ModeToggle />
          {loggedIn ? (
            <IconButton
              component="a"
              href="/admin"
              data-testid="admin-avatar"
              aria-label={t("openAdmin")}
              sx={{
                width: { xs: 30, sm: 34 },
                height: { xs: 30, sm: 34 },
                minWidth: { xs: 30, sm: 34 },
                ml: { xs: 0.5, sm: 1 },
                p: 0,
                borderRadius: "50%",
              }}
            >
              <Avatar
                src={avatarUrl || undefined}
                alt=""
                slotProps={{
                  img: {
                    onError: (event) => {
                      ;(event.currentTarget as HTMLImageElement).style.display = "none"
                    },
                  },
                }}
                sx={{
                  width: { xs: 30, sm: 34 },
                  height: { xs: 30, sm: 34 },
                  fontSize: { xs: 12, sm: 13 },
                  fontWeight: 700,
                  bgcolor: "#1C252E",
                  color: "#FFFFFF",
                  ".dark &": { bgcolor: "#FFFFFF", color: "#1C252E" },
                }}
              >
                {(username || "A").slice(0, 1).toUpperCase()}
              </Avatar>
            </IconButton>
          ) : (
            <Button
              component="a"
              href="/admin"
              size="small"
              variant="contained"
              sx={{
                height: { xs: 30, sm: 34 },
                px: { xs: 1.1, sm: 1.75 },
                ml: { xs: 0.5, sm: 1 },
                borderRadius: "8px",
                bgcolor: LITE_BLUE,
                fontSize: { xs: 12, sm: 14 },
                "&:hover": { bgcolor: LITE_BLUE_HOVER },
              }}
            >
              {t("login")}
            </Button>
          )}
        </nav>
      </div>
    </header>
  )
}

export default Header
