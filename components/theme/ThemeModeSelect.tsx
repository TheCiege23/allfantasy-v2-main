"use client"

import { useOptionalSession } from "@/components/auth/useOptionalSession"
import { useOptionalThemeMode } from "@/components/theme/ThemeProvider"
import { type ThemeId } from "@/lib/theme"
import { useOptionalLanguage } from "@/components/i18n/LanguageProviderClient"

const ROW: ThemeId[] = ["light", "dark", "legacy", "system"]

/**
 * Explicit Light / Dark / AF Legacy / System — same storage + profile sync as ModeToggle.
 */
export function ThemeModeSelect(props: {
  className?: string
  /** Smaller control for dense headers (league dashboard). */
  size?: "sm" | "md"
}) {
  const { data: session } = useOptionalSession()
  const { mode, setMode } = useOptionalThemeMode()
  const { t, tInterpolate } = useOptionalLanguage()
  const size = props.size ?? "md"

  const onChange = (next: ThemeId) => {
    setMode(next)
    if (session?.user) {
      fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ themePreference: next }),
      }).catch(() => {})
    }
  }

  return (
    <label
      className={
        props.className ??
        `inline-flex items-center gap-1.5 ${size === "sm" ? "text-[11px]" : "text-xs"}`
      }
    >
      <span className="sr-only">{t("theme.selectorTitle")}</span>
      <span className="hidden text-[var(--muted)] sm:inline" aria-hidden>
        {t("theme.selectorTitle")}
      </span>
      <select
        value={mode}
        onChange={(e) => onChange(e.target.value as ThemeId)}
        className={
          size === "sm"
            ? "max-w-[9.5rem] cursor-pointer rounded-lg border px-1.5 py-1 font-semibold outline-none focus:ring-2 focus:ring-cyan-500/40"
            : "max-w-[11rem] cursor-pointer rounded-xl border px-2 py-1.5 font-semibold outline-none focus:ring-2 focus:ring-cyan-500/40"
        }
        style={{
          color: "var(--text)",
          borderColor: "var(--border)",
          background: "var(--panel)",
        }}
        aria-label={tInterpolate("theme.current", {
          label: t(`theme.${mode}`),
        })}
        data-testid="theme-mode-select"
      >
        {ROW.map((id) => (
          <option key={id} value={id}>
            {t(`theme.${id}`)}
          </option>
        ))}
      </select>
    </label>
  )
}
