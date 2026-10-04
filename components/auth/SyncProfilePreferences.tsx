"use client"

import { useEffect, useRef } from "react"
import { useOptionalSession } from "@/components/auth/useOptionalSession"
import { useOptionalLanguage } from "@/components/i18n/LanguageProviderClient"
import { useThemeMode } from "@/components/theme/ThemeProvider"
import { getStoredLanguage } from "@/lib/preferences/LanguagePreferenceService"
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
  const { setLanguage } = useOptionalLanguage()
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

        /*
         * 🛑 ALWAYS THROUGH `setLanguage`, NEVER A STALE COMPARISON PLUS A DIRECT STORAGE WRITE
         * (2026-10-03). This read `if (language !== bootstrap.language) setLanguage(...)` and then
         * `setStoredLanguage(...)` unconditionally. `language` is captured when the effect starts —
         * before the provider has read localStorage, so still the default "en" — and the profile fetch
         * resolves later. With a Spanish browser and an English account, the stale "en" equalled the
         * account's "en", `setLanguage` was skipped, and `setStoredLanguage` rewrote localStorage,
         * the cookie and <html lang> to English under a page that stayed Spanish. Found by the My Team
         * session in a live check.
         *
         * `setLanguage` writes storage and cookie itself, and compares against the LIVE language
         * (`activeLanguageRef`), refreshing server text only on a real change — so calling it every
         * time is both correct and cheap. The account still wins when it has a language
         * (`resolveLanguagePreferenceSync`); this only makes the page agree with what is stored.
         */
        setLanguage(bootstrap.language)

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
  }, [status, session?.user, mode, setLanguage, setMode])

  return null
}
