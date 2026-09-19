"use client"

import { useEffect, useRef, useState } from "react"
import { usePathname } from "next/navigation"
import { signOutAndPurge } from "@/lib/pwa/signOutAndPurge"
import { useOptionalSession } from "@/components/auth/useOptionalSession"
import { resolveSessionIdleMs } from "@/lib/auth/session-idle-constants"

const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = [
  "mousedown",
  "keydown",
  "scroll",
  "touchstart",
  "click",
]

const STORAGE_KEY_MINUTES = "af_session_idle_minutes"
const ACTIVITY_KEY = "af_last_activity_at"

function readIdleMsFromStorage(): number | null {
  if (typeof window === "undefined") return null
  const raw = localStorage.getItem(STORAGE_KEY_MINUTES)
  if (raw === null || raw === "") return null
  const n = parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0) return null
  return resolveSessionIdleMs(n)
}

function touchActivity(): void {
  try {
    sessionStorage.setItem(ACTIVITY_KEY, String(Date.now()))
  } catch {
    // ignore
  }
}

/**
 * Signs the user out after a period of no input when Security → session idle is enabled.
 * Preference is synced to localStorage from profile fetch (see SyncProfilePreferences).
 */
export default function SessionIdleMonitor() {
  const { status } = useOptionalSession()
  const pathname = usePathname() ?? ""
  const [idleMs, setIdleMs] = useState<number | null>(null)
  const throttleRef = useRef<number | null>(null)

  useEffect(() => {
    if (pathname?.startsWith("/e2e")) {
      setIdleMs(null)
      return
    }
    const sync = () => setIdleMs(readIdleMsFromStorage())
    sync()
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY_MINUTES || e.key === null) sync()
    }
    const onCustom = () => sync()
    window.addEventListener("storage", onStorage)
    window.addEventListener("af-session-idle-updated", onCustom)
    return () => {
      window.removeEventListener("storage", onStorage)
      window.removeEventListener("af-session-idle-updated", onCustom)
    }
  }, [pathname])

  useEffect(() => {
    if (status !== "authenticated" || !idleMs) return

    touchActivity()

    const onActivity = () => {
      if (throttleRef.current != null) return
      throttleRef.current = window.setTimeout(() => {
        throttleRef.current = null
        touchActivity()
      }, 1500)
    }

    for (const ev of ACTIVITY_EVENTS) {
      window.addEventListener(ev, onActivity, { passive: true })
    }

    const interval = window.setInterval(() => {
      const raw = sessionStorage.getItem(ACTIVITY_KEY)
      const last = raw ? parseInt(raw, 10) : NaN
      if (!Number.isFinite(last)) {
        touchActivity()
        return
      }
      if (Date.now() - last >= idleMs) {
        void signOutAndPurge({ callbackUrl: "/" })
      }
    }, 15000)

    return () => {
      window.clearInterval(interval)
      if (throttleRef.current != null) window.clearTimeout(throttleRef.current)
      for (const ev of ACTIVITY_EVENTS) {
        window.removeEventListener(ev, onActivity)
      }
    }
  }, [status, idleMs])

  return null
}
