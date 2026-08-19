"use client"

import { useState, useEffect } from "react"
import ChimmyVoiceSettingsCard from "@/components/settings/ChimmyVoiceSettingsCard"
import { useThemeMode } from "@/components/theme/ThemeProvider"
import { useLanguage } from "@/components/i18n/LanguageProviderClient"
import { DEFAULT_THEME, normalizeStoredTheme, type ThemeId } from "@/lib/theme"
import { setStoredTheme } from "@/lib/preferences/ThemePreferenceService"
import { SIGNUP_TIMEZONES } from "@/lib/signup/timezones"
import {
  SUPPORTED_SPORTS,
  DEFAULT_SPORT,
  isSupportedSport,
  normalizeToSupportedSport,
  type SupportedSport,
} from "@/lib/sport-scope"
import { formatInTimezone } from "@/lib/preferences/TimezoneFormattingResolver"
import { SUPPORTED_LANGUAGES, getLanguageDisplayName, type LanguageCode } from "@/lib/i18n/constants"
import type { SettingsOnSave, SettingsProfile } from "./settings-types"

export function PreferencesSettingsSection({
  profile,
  saving,
  onSave,
}: {
  profile: SettingsProfile
  saving: boolean
  onSave: SettingsOnSave
}) {
  const { setMode } = useThemeMode()
  const { language, setLanguage, t, tInterpolate } = useLanguage()
  const [timezone, setTimezone] = useState(profile?.timezone ?? "")
  const [lang, setLang] = useState<LanguageCode>((profile?.preferredLanguage ?? language) as LanguageCode)
  const [theme, setTheme] = useState<ThemeId>(() =>
    normalizeStoredTheme(profile?.themePreference ?? DEFAULT_THEME)
  )
  const [defaultSport, setDefaultSport] = useState<SupportedSport>(() => {
    const first = profile?.preferredSports?.[0]
    return isSupportedSport(first) ? first : DEFAULT_SPORT
  })

  useEffect(() => {
    setTimezone(profile?.timezone ?? "")
    setLang(profile?.preferredLanguage ?? language)
    setTheme(normalizeStoredTheme(profile?.themePreference ?? DEFAULT_THEME))
    const first = profile?.preferredSports?.[0]
    setDefaultSport(isSupportedSport(first) ? first : DEFAULT_SPORT)
  }, [
    profile?.timezone,
    profile?.preferredLanguage,
    profile?.themePreference,
    profile?.preferredSports,
    language,
  ])

  const resetDraft = () => {
    setTimezone(profile?.timezone ?? "")
    setLang(profile?.preferredLanguage ?? language)
    setTheme(normalizeStoredTheme(profile?.themePreference ?? DEFAULT_THEME))
    const first = profile?.preferredSports?.[0]
    setDefaultSport(isSupportedSport(first) ? first : DEFAULT_SPORT)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const ok = await onSave({
      preferredLanguage: lang,
      timezone: timezone || null,
      themePreference: theme,
      preferredSports: [defaultSport],
    })
    if (ok) {
      setMode(theme)
      setStoredTheme(theme)
      setLanguage(lang)
      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem("af_lang", lang)
        } catch {
          /* ignore */
        }
      }
    }
  }

  const themeOptions: ThemeId[] = ["light", "dark", "legacy", "system"]

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold" style={{ color: "var(--text)" }}>{t("settings.preferences.title")}</h2>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>{t("settings.preferences.subtitle")}</p>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium" style={{ color: "var(--muted)" }}>{t("settings.preferences.language")}</label>
        <div
          className="flex gap-2"
          data-testid="settings-language-toggle"
          role="radiogroup"
          aria-label={t("settings.preferences.languageToggleAria")}
        >
          {SUPPORTED_LANGUAGES.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLang(l)}
              className="rounded-xl border px-4 py-2 text-sm font-medium transition hover:opacity-90"
              style={
                lang === l
                  ? {
                      borderColor: "var(--accent-cyan-strong)",
                      background: "color-mix(in srgb, var(--accent-cyan) 12%, transparent)",
                      color: "var(--text)",
                    }
                  : {
                      borderColor: "var(--border)",
                      background: "var(--panel)",
                      color: "var(--muted)",
                    }
              }
              role="radio"
              aria-checked={lang === l}
            >
              {getLanguageDisplayName(l)}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium" style={{ color: "var(--muted)" }}>{t("settings.preferences.timezone")}</label>
        <select
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          className="w-full max-w-md rounded-xl border px-3 py-2 text-sm outline-none"
          style={{
            borderColor: "var(--border)",
            background: "var(--panel2)",
            color: "var(--text)",
          }}
        >
          <option value="">{t("settings.preferences.timezonePlaceholder")}</option>
          {SIGNUP_TIMEZONES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        {timezone && (
          <p className="mt-1.5 text-xs" style={{ color: "var(--muted2)" }}>
            {tInterpolate("settings.preferences.localTime", {
              time: formatInTimezone(new Date(), timezone, undefined, lang),
            })}
          </p>
        )}
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium" style={{ color: "var(--muted)" }}>{t("settings.preferences.defaultSport")}</label>
        <select
          value={defaultSport}
          onChange={(e) => setDefaultSport(normalizeToSupportedSport(e.target.value))}
          className="w-full max-w-md rounded-xl border px-3 py-2 text-sm outline-none"
          style={{
            borderColor: "var(--border)",
            background: "var(--panel2)",
            color: "var(--text)",
          }}
        >
          {SUPPORTED_SPORTS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium" style={{ color: "var(--muted)" }}>{t("settings.preferences.theme")}</label>
        <div className="flex flex-wrap gap-2">
          {themeOptions.map((themeId) => (
            <button
              key={themeId}
              type="button"
              onClick={() => setTheme(themeId)}
              className="rounded-xl border px-4 py-2 text-sm font-medium transition hover:opacity-90"
              style={
                theme === themeId
                  ? {
                      borderColor: "var(--accent-cyan-strong)",
                      background: "color-mix(in srgb, var(--accent-cyan) 12%, transparent)",
                      color: "var(--text)",
                    }
                  : {
                      borderColor: "var(--border)",
                      background: "var(--panel)",
                      color: "var(--muted)",
                    }
              }
            >
              {t(`theme.${themeId}`)}
            </button>
          ))}
        </div>
        {theme === "system" && (
          <p className="mt-1.5 text-xs" style={{ color: "var(--muted2)" }}>{t("settings.preferences.systemThemeHint")}</p>
        )}
      </div>

      <ChimmyVoiceSettingsCard />

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-xl bg-gradient-to-r from-violet-500/90 to-purple-600/90 px-4 py-2 text-sm font-semibold text-white shadow-lg disabled:opacity-60"
        >
          {saving ? t("settings.actions.saving") : t("settings.preferences.save")}
        </button>
        <button
          type="button"
          onClick={resetDraft}
          className="rounded-xl border px-4 py-2 text-sm font-medium transition hover:opacity-90"
          style={{
            borderColor: "var(--border)",
            background: "var(--panel)",
            color: "var(--muted)",
          }}
        >
          {t("settings.actions.cancelChanges")}
        </button>
      </div>
    </form>
  )
}
