"use client"

import { useEffect, useState } from "react"
import { isTrustedWebActivity } from "@/lib/platform/isTrustedWebActivity"
import { PLAY_STORE_URL, shouldOfferAndroidApp } from "@/lib/platform/androidApp"
import "./android-bracket-app-option.css"

/** An Android browser can continue here or install the Play app. */
export default function AndroidBracketAppOption() {
  const [show, setShow] = useState(false)
  useEffect(() => {
    setShow(shouldOfferAndroidApp({ userAgent: navigator.userAgent, inTrustedWebActivity: isTrustedWebActivity() }))
  }, [])
  if (!show) return null
  return <aside className="af-bracket-app-option" data-testid="android-bracket-app-option">
    <p>Use the website, or get AllFantasy on Google Play. After installing, return to your invitation link.</p>
    <a href={PLAY_STORE_URL} target="_blank" rel="noopener noreferrer">Get it on Google Play</a>
  </aside>
}
