"use client"

import { useEffect, useState } from "react"
import { APP_STORE_URL, shouldOfferIosApp } from "@/lib/platform/iosAppStore"
import "./android-bracket-app-option.css"

/**
 * An iPhone browser can join here and get the App Store app — the iPhone twin of AndroidBracketAppOption,
 * mounted beside it (each shows only on its own platform). An invite always opens in Safari on iPhone
 * (lib/platform/iosAppStore.ts), so the order is: join here first, then the app.
 */
export default function IosBracketAppOption() {
  const [show, setShow] = useState(false)
  useEffect(() => {
    setShow(shouldOfferIosApp(navigator.userAgent))
  }, [])
  if (!show) return null
  return <aside className="af-bracket-app-option" data-testid="ios-bracket-app-option">
    <p>Join here, then get the AllFantasy app for iPhone. Sign in with the same account and your bracket is there.</p>
    <a href={APP_STORE_URL} target="_blank" rel="noopener noreferrer">Download on the App Store</a>
  </aside>
}
