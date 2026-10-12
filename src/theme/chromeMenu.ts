import type { SxProps, Theme } from "@mui/material/styles"

export const chromeMenuSlotProps = {
  paper: {
    elevation: 0,
    className: "lite-chrome-menu",
    sx: {
      mt: 1,
      minWidth: 180,
      maxWidth: "calc(100vw - 24px)",
      borderRadius: "8px",
      overflow: "visible",
      boxShadow: "0 0 2px 0 rgba(145, 158, 171, 0.24), 0 12px 24px -4px rgba(145, 158, 171, 0.16)",
    },
  },
  list: {
    disablePadding: true,
  },
} as const

export function chromeMenuItemSx(selected?: boolean): SxProps<Theme> {
  return {
    mx: 0,
    my: 0,
    px: 1.5,
    width: "100%",
    boxSizing: "border-box",
    borderRadius: "8px",
    minHeight: 40,
    fontSize: 14,
    fontWeight: selected ? 700 : 500,
  }
}
