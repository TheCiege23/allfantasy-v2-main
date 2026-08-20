"use client"

import { useEffect, useRef } from "react"

import { ACQUISITION } from "@/lib/analytics/eventNames"

/**
 * Fires exactly one `acquisition.landing_viewed` beacon per mount.
 *
 * Deliberately client-side rather than emitted from the landing server component: Next
 * prefetches links to `/`, and a server component would count every prefetch and every
 * re-render as a visit. An effect fires only when a real browser actually mounts the page.
 *
 * The ref guard handles React 18 StrictMode, which double-invokes effects in development —
 * without it, local runs would report exactly twice the real landing traffic. The server's
 * dedup window is the authoritative protection (it also covers reloads and duplicate
 * requests from other tabs); this guard just avoids an obviously wasted request.
 *
 * Renders nothing and never blocks the page: a rejected or failed beacon is swallowed,
 * because analytics must not be able to break the landing page.
 */
export function LandingViewBeacon({ landingPath }: { landingPath?: string }) {
  const firedRef = useRef(false)

  useEffect(() => {
    if (firedRef.current) return
    firedRef.current = true

    const path = landingPath ?? (typeof window !== "undefined" ? window.location.pathname : "/")

    // No campaign data is sent: the server reads it from httpOnly attribution cookies, so
    // a client cannot claim a campaign it did not arrive through.
    void fetch("/api/analytics/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: ACQUISITION.LANDING_VIEWED, meta: { landing_path: path } }),
      keepalive: true,
    }).catch(() => {})
  }, [landingPath])

  return null
}
