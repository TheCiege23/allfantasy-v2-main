"use client"

import React, { useCallback } from "react"
import { useOptionalSession } from "@/components/auth/useOptionalSession"
import { useOptionalThemeMode } from "./ThemeProvider"
import { getNextTheme, THEME_IDS, type ThemeId } from "@/lib/theme"
import { useOptionalLanguage } from "@/components/i18n/LanguageProviderClient"
import "./mode-toggle.css"

/**
 * The display-mode control.
 *
 * `variant="picker"` shows all four settings at once (Light / Dark / AF Legacy / System) as a radio
 * group, with the chosen one marked — the account menu on /core uses it. The default stays the
 * compact one-button cycle for tight spots (the floating pill, the World Cup bracket headers).
 *
 * ⚠ BOTH NAME THE SETTING, NOT THE PAINT. The cycle button used to read <html data-mode>, so on System
 * it said "DARK" (or "LIGHT") — the mode System happened to resolve to — and nobody could tell System
 * was chosen. The label is the stored setting now; what System resolves to is the theme's business.
 */
export function ModeToggle(props: { className?: string; variant?: "cycle" | "picker" }) {
  const { data: session } = useOptionalSession()
  // Optional, like the session and language hooks beside it: rendered without a ThemeProvider
  // (tests, isolated renders) it shows the document's mode instead of throwing.
  const { mode, setMode } = useOptionalThemeMode()
  const { t, tInterpolate } = useOptionalLanguage()

  const choose = useCallback(
    (next: ThemeId) => {
      setMode(next)
      if (session?.user) {
        fetch("/api/user/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ themePreference: next }),
        }).catch(() => {})
      }
    },
    [setMode, session?.user],
  )

  if (props.variant === "picker") {
    return (
      <div
        role="radiogroup"
        aria-label={t("theme.selectorTitle")}
        className={`af-mode-picker${props.className ? ` ${props.className}` : ""}`}
        data-testid="mode-picker"
      >
        {THEME_IDS.map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={mode === id}
            onClick={() => choose(id)}
            className="af-mode-picker-option"
            data-mode-option={id}
            suppressHydrationWarning
          >
            {t(`theme.${id}`)}
          </button>
        ))}
      </div>
    )
  }

  const label = t(`theme.${mode}`)
  const nextLabel = t(`theme.${getNextTheme(mode)}`)
  const title = `${tInterpolate("theme.current", { label })} · ${tInterpolate("theme.ariaSwitch", { label: nextLabel })}`

  return (
    <button
      type="button"
      onClick={() => choose(getNextTheme(mode))}
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
      data-mode-setting={mode}
      suppressHydrationWarning
    >
      {label}
    </button>
  )
}
