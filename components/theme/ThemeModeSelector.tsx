"use client"

import { useCallback, useEffect, useState } from "react"
import { useOptionalSession } from "@/components/auth/useOptionalSession"
import { useLanguage } from "@/components/i18n/LanguageProviderClient"
import { useThemeMode } from "./ThemeProvider"
import { type ThemeId } from "@/lib/theme"
import { setStoredTheme } from "@/lib/preferences/ThemePreferenceService"

const THEME_IDS: ThemeId[] = ["light", "dark", "legacy", "system"]

export function ThemeModeSelector({ className }: { className?: string }) {
  const { data: session } = useOptionalSession()
  const { t, tInterpolate } = useLanguage()
  const { mode, setMode } = useThemeMode()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  const handleSelect = useCallback(
    (t: ThemeId) => {
      setMode(t)
      setStoredTheme(t)
      if (session?.user) {
        fetch("/api/user/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ themePreference: t }),
        }).catch(() => {})
      }
    },
    [setMode, session?.user],
  )

  return (
    <div className={className}>
      <p
        className="mb-1.5 text-[11px] font-medium uppercase tracking-widest"
        style={{ color: "var(--muted2)" }}
      >
        {t("theme.selectorTitle")}
      </p>
      <div className="flex gap-1">
        {THEME_IDS.map((id) => {
          const isActive = mounted && mode === id
          const label = t(`theme.${id}`)
          return (
            <button
              key={id}
              type="button"
              onClick={() => handleSelect(id)}
              className="flex-1 rounded-lg border px-1 py-1.5 text-[11px] font-semibold transition-colors"
              style={
                isActive
                  ? {
                      borderColor: "var(--accent-cyan-strong)",
                      background: "color-mix(in srgb, var(--accent-cyan) 12%, transparent)",
                      color: "var(--accent-cyan-strong)",
                    }
                  : {
                      borderColor: "var(--border)",
                      background: "var(--panel2)",
                      color: "var(--muted)",
                    }
              }
              aria-label={tInterpolate("theme.current", { label })}
              suppressHydrationWarning
            >
              {label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
