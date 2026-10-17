"use client"

import { useEffect } from "react"
import { useSession } from "next-auth/react"
import { AD_OPT_OUT_COOKIE, AD_OPT_OUT_COOKIE_MAX_AGE_SECONDS } from "@/lib/privacy/adMeasurementOptOut"

/**
 * Carries a signed-in person's "Do Not Sell or Share" choice to every browser they use.
 *
 * The account record already stops the server-side events everywhere; the ad TAGS are
 * decided in the browser, from Global Privacy Control or the af_ad_optout cookie, before
 * any of this runs (app/layout.tsx). So on a browser that has not seen the choice yet, this
 * sets the cookie for every page after the first. And a signed-in browser sending GPC is
 * recorded on the account, which is what makes GPC reach the server-side events.
 *
 * Once per user per tab session — the answer is cached in sessionStorage.
 */
export function AdOptOutSync() {
  const session = useSession()?.data
  const userId = (session?.user as { id?: string } | undefined)?.id

  useEffect(() => {
    if (!userId) return
    const key = `af_ad_optout_sync:${userId}`
    try {
      if (sessionStorage.getItem(key)) return
      sessionStorage.setItem(key, "1")
    } catch {
      // Storage blocked: run anyway, it is one small request.
    }
    const gpc = (navigator as { globalPrivacyControl?: boolean }).globalPrivacyControl === true
    void (async () => {
      try {
        const res = await fetch("/api/privacy/ad-opt-out", { cache: "no-store" })
        if (!res.ok) return
        const data = (await res.json()) as { signedIn?: boolean; accountOptedOut?: boolean }
        if (!data.signedIn) return
        if (data.accountOptedOut) {
          if (!/(?:^|;\s*)af_ad_optout=1(?:;|$)/.test(document.cookie)) {
            document.cookie = `${AD_OPT_OUT_COOKIE}=1; Max-Age=${AD_OPT_OUT_COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=Lax`
          }
        } else if (gpc) {
          await fetch("/api/privacy/ad-opt-out", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ optOut: true, source: "gpc" }),
          })
        }
      } catch {
        // Best effort. The server-side check reads GPC from every request regardless.
      }
    })()
  }, [userId])

  return null
}
