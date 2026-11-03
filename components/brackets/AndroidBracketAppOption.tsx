"use client"

import { useEffect, useState } from "react"
import { isTrustedWebActivity } from "@/lib/platform/isTrustedWebActivity"
import "./android-bracket-app-option.css"

/** An Android browser can continue here or install the Play app. */
export default function AndroidBracketAppOption() {
  const [show, setShow] = useState(false)
  useEffect(() => {
    setShow(/Android/i.test(navigator.userAgent) && !isTrustedWebActivity())
  }, [])
  if (!show) return null
  return <aside className="af-bracket-app-option" data-testid="android-bracket-app-option">
    <p>Use the website, or get AllFantasy on Google Play. After installing, return to your invitation link.</p>
    <a href="https://play.google.com/store/apps/details?id=ai.allfantasy.app" target="_blank" rel="noopener noreferrer">Get it on Google Play</a>
  </aside>
}
