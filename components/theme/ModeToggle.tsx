"use client"

import React, { useCallback, useEffect, useState } from "react"
import { useOptionalSession } from "@/components/auth/useOptionalSession"
import { useOptionalThemeMode } from "./ThemeProvider"
import { getNextTheme } from "@/lib/theme"
import { useOptionalLanguage } from "@/components/i18n/LanguageProviderClient"

export function ModeToggle(props: { className?: string }) {
  const { data: session } = useOptionalSession()
  // Optional, like the session and language hooks beside it: rendered in a /core top bar without a
  // ThemeProvider (tests, isolated renders) it shows the document's mode instead of throwing.
  const { mode, cycleMode } = useOptionalThemeMode()
  const { t, tInterpolate } = useOptionalLanguage()
  const [appliedMode, setAppliedMode] = useState<string | null>(null)

  useEffect(() => {
    if (typeof document === "undefined") return
    const readAppliedMode = () => {
      setAppliedMode(document.documentElement.dataset.mode ?? null)
    }
    readAppliedMode()
    const observer = new MutationObserver(readAppliedMode)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-mode"],
    })
    return () => observer.disconnect()
  }, [])

  const handleClick = useCallback(() => {
    const next = getNextTheme(mode)
    cycleMode()
    if (session?.user) {
      fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ themePreference: next }),
      }).catch(() => {})
    }
  }, [mode, cycleMode, session?.user])

  const displayMode = appliedMode === "dark" || appliedMode === "light" || appliedMode === "legacy" ? appliedMode : mode
  const label = t(`theme.${displayMode}`)
  const title = tInterpolate("theme.current", { label })

  return (
    <button
      onClick={handleClick}
      className={
        props.className ??
        "rounded-xl border px-3 py-2 text-sm font-semibold active:scale-[0.98] transition"
      }
      style={{
        color: "var(--text)",
        borderColor: "var(--border)",
        background: "var(--panel)",
      }}
      title={title}
      aria-label={title}
      suppressHydrationWarning
    >
      {label}
    </button>
  )
}
