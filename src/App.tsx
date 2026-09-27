import { useQuery } from "@tanstack/react-query"
import React, { useEffect, useLayoutEffect } from "react"
import { Route, BrowserRouter as Router, Routes } from "react-router-dom"

import ErrorBoundary from "./components/ErrorBoundary"
import Footer from "./components/Footer"
import Header from "./components/Header"
import RouteView from "./components/RouteView"
import { Loader } from "./components/loading/Loader"
import { useBackground } from "./hooks/use-background"
import { useTheme } from "./hooks/use-theme"
import { changePublicLanguage, readStoredLanguage, resolvePublicLanguage } from "./i18n"
import { InjectContext } from "./lib/inject"
import { fetchSetting } from "./lib/lite-api"
import { cn } from "./lib/utils"
import ErrorPage from "./pages/ErrorPage"
import NotFound from "./pages/NotFound"
import Server from "./pages/Server"
import ServerDetail from "./pages/ServerDetail"

const MainApp: React.FC = () => {
  const { data: settingData, error } = useQuery({
    queryKey: ["setting"],
    queryFn: () => fetchSetting(),
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  })
  const { setTheme } = useTheme()
  const { backgroundImage: customBackgroundImage } = useBackground()
  const configuredLanguage = settingData?.data?.config?.language

  useLayoutEffect(() => {
    if (settingData?.data?.config?.custom_code) {
      void InjectContext(settingData.data.config.custom_code)
    }
  }, [settingData?.data?.config?.custom_code])

  const forceTheme =
    // @ts-expect-error ForceTheme is a global variable
    (window.ForceTheme as string) !== "" ? window.ForceTheme : undefined

  useEffect(() => {
    if (forceTheme === "dark" || forceTheme === "light") {
      setTheme(forceTheme)
    }
  }, [forceTheme, setTheme])

  useEffect(() => {
    if (!configuredLanguage || readStoredLanguage()) return
    const lng = resolvePublicLanguage(configuredLanguage)
    if (!lng) return
    void changePublicLanguage(lng, { persist: false })
  }, [configuredLanguage])

  if (error) {
    return <ErrorPage code={500} message={error.message} />
  }

  const customMobileBackgroundImage = window.CustomMobileBackgroundImage !== "" ? window.CustomMobileBackgroundImage : undefined

  return (
    <ErrorBoundary>
      {/* 固定定位的背景层 */}
      {customBackgroundImage && (
        <div
          className={cn("fixed inset-0 z-0 bg-cover min-h-lvh bg-no-repeat bg-center dark:brightness-75", {
            "hidden sm:block": customMobileBackgroundImage,
          })}
          style={{ backgroundImage: `url(${customBackgroundImage})` }}
        />
      )}
      {customMobileBackgroundImage && (
        <div
          className={cn("fixed inset-0 z-0 bg-cover min-h-lvh bg-no-repeat bg-center sm:hidden dark:brightness-75")}
          style={{ backgroundImage: `url(${customMobileBackgroundImage})` }}
        />
      )}
      <div
        className={cn("flex min-h-screen w-full flex-col", {
          "bg-background": !customBackgroundImage,
        })}
      >
        <Header />
        <div className="h-[calc(var(--lite-header-height)+var(--safe-area-top))] shrink-0" aria-hidden="true" />
        <main className="lite-page-shell z-20 flex flex-1 flex-col pt-6 pb-[max(0.5rem,var(--safe-area-bottom))] max-[967px]:pt-[15px]">
          {!settingData ? (
            <Loader visible />
          ) : (
            <RouteView>
              <Routes>
                <Route path="/" element={<Server />} />
                <Route path="/server/:id" element={<ServerDetail />} />
                <Route path="/instance/:id" element={<ServerDetail />} />
                <Route path="/error" element={<ErrorPage />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
              <Footer />
            </RouteView>
          )}
        </main>
      </div>
    </ErrorBoundary>
  )
}

const App: React.FC = () => {
  return (
    <Router basename={import.meta.env.BASE_URL}>
      <MainApp />
    </Router>
  )
}

export default App
