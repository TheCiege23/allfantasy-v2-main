"use client"

import { useEffect, useRef, useState } from "react"
import { isInIosAppClient } from "@/lib/platform/iosApp"
import { ReferralProWeekBanner } from "./ReferralProWeekBanner"

/**
 * When the page loads with ?ref=CODE, call track-click to record the click and set af_ref cookie
 * so that signup can attribute the new user to the referrer.
 *
 * Once the code is confirmed valid, the visitor sees the "give a week, get a week" offer
 * (`ReferralProWeekBanner`) — never inside the iOS app, which does not advertise it.
 */
export function ReferralTracker() {
  const done = useRef(false)
  const [validCode, setValidCode] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window === "undefined" || done.current) return
    const params = new URLSearchParams(window.location.search)
    const ref = params.get("ref")?.trim()
    if (!ref) return
    done.current = true
    fetch("/api/referral/track-click", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref }),
      credentials: "same-origin",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: unknown) => {
        if (j && typeof j === "object" && (j as { ok?: unknown }).ok === true && !isInIosAppClient()) setValidCode(ref)
      })
      .catch(() => {})
  }, [])

  return validCode ? <ReferralProWeekBanner code={validCode} /> : null
}
