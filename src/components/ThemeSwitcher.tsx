import { IconButton, ListItemIcon, ListItemText, Menu, MenuItem } from "@mui/material"
import { Check, Moon, Sun } from "lucide-react"
import { MouseEvent, type ComponentType, useState } from "react"
import { useTranslation } from "react-i18next"

import { Theme } from "@/components/ThemeProvider"
import { useTheme } from "@/hooks/use-theme"
import { chromeMenuItemSx, chromeMenuSlotProps } from "@/theme/chromeMenu"

function AutoThemeIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      data-testid="AutoThemeIcon"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M8 16.5 12 7.5l4 9" />
      <path d="M9.4 13.4h5.2" />
    </svg>
  )
}

export function ModeToggle() {
  const { t } = useTranslation()
  const { setTheme, theme } = useTheme()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const options: Array<{ value: Theme; label: string; icon: ComponentType<{ className?: string }> }> = [
    { value: "light", label: t("theme.light"), icon: Sun },
    { value: "dark", label: t("theme.dark"), icon: Moon },
    { value: "system", label: t("theme.system"), icon: AutoThemeIcon },
  ]

  const openMenu = (event: MouseEvent<HTMLElement>) => setAnchor(event.currentTarget)
  const selectTheme = (value: Theme) => {
    setTheme(value)
    setAnchor(null)
  }

  return (
    <>
      <IconButton
        size="small"
        onClick={openMenu}
        aria-label={t("changeTheme")}
        sx={{ width: 36, height: 36, borderRadius: "6px", color: "text.secondary" }}
      >
        <Sun className="size-[18px] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
        <Moon className="absolute size-[18px] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
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
        {options.map((option) => {
          const Icon = option.icon
          const selected = theme === option.value
          return (
            <MenuItem
              key={option.value}
              selected={selected}
              onClick={() => selectTheme(option.value)}
              sx={chromeMenuItemSx(selected)}
            >
              <ListItemIcon sx={{ minWidth: 32, color: "inherit" }}><Icon className="size-4" /></ListItemIcon>
              <ListItemText sx={{ my: 0, "& .MuiListItemText-primary": { fontSize: "inherit", fontWeight: "inherit" } }}>{option.label}</ListItemText>
              {selected ? <ListItemIcon sx={{ minWidth: 0, ml: 2, color: "inherit" }}><Check className="size-4" /></ListItemIcon> : null}
            </MenuItem>
          )
        })}
      </Menu>
    </>
  )
}
