import { m, useReducedMotion } from "framer-motion"
import type { ReactNode } from "react"
import { useLocation } from "react-router-dom"

export default function RouteView({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const reduceMotion = useReducedMotion()

  return (
    <m.div
      key={pathname}
      className="flex flex-1 flex-col"
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </m.div>
  )
}
