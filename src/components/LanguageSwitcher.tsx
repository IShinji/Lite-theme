import { changePublicLanguage, preloadPublicLocales } from "@/i18n"
import { chromeMenuItemSx, chromeMenuSlotProps } from "@/theme/chromeMenu"
import { IconButton, ListItemIcon, ListItemText, Menu, MenuItem } from "@mui/material"
import { Check, Languages } from "lucide-react"
import { MouseEvent, useState } from "react"
import { useTranslation } from "react-i18next"

export const PUBLIC_LOCALES = [
  { name: "简体中文", code: "zh-CN" },
  { name: "繁體中文", code: "zh-TW" },
  { name: "English", code: "en-US" },
  { name: "日本語", code: "ja-JP" },
] as const

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const locale = i18n.resolvedLanguage || i18n.language

  const openMenu = (event: MouseEvent<HTMLElement>) => {
    void preloadPublicLocales()
    setAnchor(event.currentTarget)
  }
  const selectLocale = (code: string) => {
    void changePublicLanguage(code)
    setAnchor(null)
  }

  return (
    <>
      <IconButton
        size="small"
        onClick={openMenu}
        aria-label={t("changeLanguage")}
        sx={{ width: 36, height: 36, borderRadius: "6px", color: "text.secondary" }}
      >
        <Languages className="size-[18px]" />
      </IconButton>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        disableAutoFocusItem
        marginThreshold={12}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={chromeMenuSlotProps}
      >
        {PUBLIC_LOCALES.map((item) => {
          const selected = locale === item.code
          return (
            <MenuItem
              key={item.code}
              selected={selected}
              onClick={() => selectLocale(item.code)}
              sx={chromeMenuItemSx(selected)}
            >
              <ListItemText sx={{ my: 0, "& .MuiListItemText-primary": { fontSize: "inherit", fontWeight: "inherit" } }}>{item.name}</ListItemText>
              {selected ? (
                <ListItemIcon sx={{ minWidth: 0, ml: 2, color: "inherit" }}>
                  <Check className="size-4" />
                </ListItemIcon>
              ) : null}
            </MenuItem>
          )
        })}
      </Menu>
    </>
  )
}
