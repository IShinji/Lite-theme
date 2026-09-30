import { useEffect, useState } from "react"

declare global {
  interface Window {
    CustomBackgroundImage: string
    CustomMobileBackgroundImage: string
    ForcePeakCutEnabled: boolean
    ShowServerBandwidth?: boolean
    ShowHomePacketLoss?: boolean
    ShowServerRemainingValue?: boolean
    DefaultProbeChartHours?: string
    HomeSortType?: string
    HomeSortOrder?: string
  }
}

const BACKGROUND_CHANGE_EVENT = "backgroundChange"

export function useBackground() {
  const [backgroundImage, setBackgroundImage] = useState<string | undefined>(undefined)

  useEffect(() => {
    const handleBackgroundChange = () => {
      setBackgroundImage(window.CustomBackgroundImage || undefined)
    }

    const checkInitialBackground = () => {
      if (window.CustomBackgroundImage) {
        setBackgroundImage(window.CustomBackgroundImage)
      } else {
        const savedImage = sessionStorage.getItem("savedBackgroundImage")
        if (savedImage) {
          window.CustomBackgroundImage = savedImage
          setBackgroundImage(savedImage)
        }
      }
    }

    const intervalId = setInterval(() => {
      if (window.CustomBackgroundImage || sessionStorage.getItem("savedBackgroundImage")) {
        checkInitialBackground()
        clearInterval(intervalId)
      }
    }, 100)

    window.addEventListener(BACKGROUND_CHANGE_EVENT, handleBackgroundChange)

    return () => {
      window.removeEventListener(BACKGROUND_CHANGE_EVENT, handleBackgroundChange)
      clearInterval(intervalId)
    }
  }, [])

  return { backgroundImage }
}
