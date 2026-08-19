"use client"

import { useEffect, useRef } from "react"
import { useOptionalSession } from "@/components/auth/useOptionalSession"
import { useOptionalLanguage } from "@/components/i18n/LanguageProviderClient"
import { useThemeMode } from "@/components/theme/ThemeProvider"
import {
  getStoredLanguage,
  setStoredLanguage,
} from "@/lib/preferences/LanguagePreferenceService"
import {
  getStoredThemePreference,
  setStoredTheme,
} from "@/lib/preferences/ThemePreferenceService"
import { resolveSharedSessionBootstrap } from "@/lib/auth/SharedSessionBootstrapService"

/**
 * When the user is authenticated, sync profile preferences (language, theme, timezone) from server to client.
 * Applies to LanguageProvider, ThemeProvider, and localStorage so preferences persist across reload and match server.
 */
export default function SyncProfilePreferences() {
  const { data: session, status } = useOptionalSession()
  const { language, setLanguage } = useOptionalLanguage()
  const { mode, setMode } = useThemeMode()
  const syncedSessionKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (status === "unauthenticated") {
      syncedSessionKeyRef.current = null
      try {
        localStorage.removeItem("af_session_idle_minutes")
        window.dispatchEvent(new Event("af-session-idle-updated"))
      } catch {
        // ignore
      }
      return
    }
    if (status !== "authenticated" || !session?.user) return

    const sessionKey =
      (typeof (session.user as { id?: string }).id === "string" &&
        (session.user as { id?: string }).id) ||
      (typeof session.user.email === "string" && session.user.email) ||
      "authenticated"

    if (syncedSessionKeyRef.current === sessionKey) return
    syncedSessionKeyRef.current = sessionKey

    fetch("/api/user/profile", { cache: "no-store" })
      .then((r) => r.json())
      .then((data: Record<string, unknown>) => {
        const bootstrap = resolveSharedSessionBootstrap({
          profile: data,
          storedLanguagePreference: getStoredLanguage(),
          storedThemePreference: getStoredThemePreference(),
        })

        if (language !== bootstrap.language) {
          setLanguage(bootstrap.language)
        }
        setStoredLanguage(bootstrap.language)

        if (mode !== bootstrap.theme) {
          setMode(bootstrap.theme)
        }
        setStoredTheme(bootstrap.theme)

        if (Object.keys(bootstrap.patchPayload).length > 0) {
          fetch("/api/user/profile", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(bootstrap.patchPayload),
          }).catch(() => {})
        }

        const idleMin = data.sessionIdleTimeoutMinutes
        if (typeof idleMin === "number" && idleMin > 0) {
          localStorage.setItem("af_session_idle_minutes", String(idleMin))
        } else {
          localStorage.removeItem("af_session_idle_minutes")
        }
        try {
          window.dispatchEvent(new Event("af-session-idle-updated"))
        } catch {
          // ignore
        }
      })
      .catch(() => {})
  }, [status, session?.user, language, mode, setLanguage, setMode])

  return null
}
