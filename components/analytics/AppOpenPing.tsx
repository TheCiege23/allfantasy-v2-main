"use client"

import { useEffect } from "react"

import { appPlatformProperties } from "@/lib/platform/appPlatform"

const STORAGE_KEY = "af_app_open_v1"

/**
 * Sends one "app opened" ping per platform per UTC day (see lib/analytics/appOpen.ts).
 * Renders nothing. The server drops repeats too, so a blocked localStorage only costs
 * an extra request, never a double count.
 *
 * ⚠ Keyed by platform, not just by day: the Android app shares Chrome's storage, so a
 * single "sent today" flag would hide a same-day visit in an ordinary Chrome tab.
 */
export function AppOpenPing() {
  useEffect(() => {
    const { app_platform, ios_iap_build } = appPlatformProperties()
    const today = new Date().toISOString().slice(0, 10)
    let sent: Record<string, string> = {}
    try {
      sent = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, string>
    } catch {
      sent = {}
    }
    if (sent[app_platform] === today) return

    void fetch("/api/analytics/app-open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform: app_platform, iosIapBuild: ios_iap_build, path: window.location.pathname }),
      keepalive: true,
    })
      .then((res) => {
        if (!res.ok) return
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...sent, [app_platform]: today }))
        } catch {
          /* storage blocked: the server still drops the repeat */
        }
      })
      .catch(() => undefined)
  }, [])
  return null
}
