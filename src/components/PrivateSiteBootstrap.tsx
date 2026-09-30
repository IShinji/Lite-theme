import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"

import ErrorPage from "@/pages/ErrorPage"
import { StatusProvider } from "@/context/status-provider"
import { WebSocketProvider } from "@/context/websocket-provider"
import { RPC2Provider } from "@/hooks/use-rpc2"
import { fetchSetting } from "@/lib/lite-api"
import { isRpcAuthLossError, setRpcAuthLossHandler } from "@/lib/rpc-auth"
import { Loader } from "@/components/loading/Loader"

import PrivateAccessGate from "./PrivateAccessGate"

export default function PrivateSiteBootstrap({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient()
  const { data, error, isPending } = useQuery({
    queryKey: ["setting"],
    queryFn: () => fetchSetting(),
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
    retry: (failureCount, queryError) => !isRpcAuthLossError(queryError) && failureCount < 1,
  })
  const [sessionLost, setSessionLost] = useState(false)

  useEffect(() => {
    setRpcAuthLossHandler(() => {
      setSessionLost(true)
      void queryClient.cancelQueries()
      void queryClient.invalidateQueries({ queryKey: ["me"] })
    })
    return () => {
      setRpcAuthLossHandler(null)
    }
  }, [queryClient])

  if (isPending) {
    return (
      <div className="flex min-h-screen w-full flex-col">
        <Loader visible />
      </div>
    )
  }

  if (error) {
    return <ErrorPage code={500} message={error.message} />
  }

  if (sessionLost || data?.data.private_site) {
    return (
      <PrivateAccessGate
        siteName={data?.data.config.site_name}
        siteDesc={data?.data.config.site_desc}
      />
    )
  }

  return (
    <RPC2Provider>
      <WebSocketProvider>
        <StatusProvider>{children}</StatusProvider>
      </WebSocketProvider>
    </RPC2Provider>
  )
}
