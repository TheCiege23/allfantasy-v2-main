"use client"

import { useState, useEffect } from "react"
import { Check } from "lucide-react"
import ChimmyVoiceSettingsCard from "@/components/settings/ChimmyVoiceSettingsCard"
import ChimmyPreferencesCard from "@/components/settings/ChimmyPreferencesCard"
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
import { SELECTABLE_LANGUAGES, getLanguageOptionLabel, type LanguageCode } from "@/lib/i18n/constants"
import type { SettingsOnSave, SettingsProfile } from "./settings-types"
import { useSavedFlash } from "./useSavedFlash"

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
  const savedFlash = useSavedFlash()
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
    savedFlash.clear()
    setTimezone(profile?.timezone ?? "")
    setLang(profile?.preferredLanguage ?? language)
    setTheme(normalizeStoredTheme(profile?.themePreference ?? DEFAULT_THEME))
    const first = profile?.preferredSports?.[0]
    setDefaultSport(isSupportedSport(first) ? first : DEFAULT_SPORT)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    savedFlash.clear()
    /*
     * The default sport is the FIRST preferred sport, not the only one. This used to send
     * [defaultSport] alone, so saving Preferences quietly erased every other sport picked under
     * Profile. Keep the rest, in order, behind the new default.
     */
    const otherSports = (profile?.preferredSports ?? []).filter((s) => s !== defaultSport)
    const ok = await onSave({
      preferredLanguage: lang,
      timezone: timezone || null,
      themePreference: theme,
      preferredSports: [defaultSport, ...otherSports],
    })
    if (ok) {
      savedFlash.flash()
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
          className="flex flex-wrap gap-2"
          data-testid="settings-language-toggle"
          role="radiogroup"
          aria-label={t("settings.preferences.languageToggleAria")}
        >
          {/* SELECTABLE, not SUPPORTED: future-only languages (fr/ar) have zero
              bundled strings and are not offered — see lib/i18n/constants. */}
          {SELECTABLE_LANGUAGES.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => {
                savedFlash.clear()
                setLang(l)
              }}
              className="inline-flex items-center gap-1.5 rounded-xl border px-4 py-2 text-sm font-medium transition hover:opacity-90"
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
              {lang === l ? <Check className="ns-chip-check" aria-hidden="true" /> : null}
              {getLanguageOptionLabel(l)}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium" style={{ color: "var(--muted)" }}>{t("settings.preferences.timezone")}</label>
        <select
          value={timezone}
          onChange={(e) => {
            savedFlash.clear()
            setTimezone(e.target.value)
          }}
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
          onChange={(e) => {
            savedFlash.clear()
            setDefaultSport(normalizeToSupportedSport(e.target.value))
          }}
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
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("settings.preferences.theme")}>
          {themeOptions.map((themeId) => (
            <button
              key={themeId}
              type="button"
              onClick={() => {
                savedFlash.clear()
                setTheme(themeId)
              }}
              role="radio"
              aria-checked={theme === themeId}
              className="inline-flex items-center gap-1.5 rounded-xl border px-4 py-2 text-sm font-medium transition hover:opacity-90"
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
              {theme === themeId ? <Check className="ns-chip-check" aria-hidden="true" /> : null}
              {t(`theme.${themeId}`)}
            </button>
          ))}
        </div>
        {theme === "system" && (
          <p className="mt-1.5 text-xs" style={{ color: "var(--muted2)" }}>{t("settings.preferences.systemThemeHint")}</p>
        )}
      </div>

      <ChimmyVoiceSettingsCard />

      {/*
        Saves on change through its own endpoint, not through this form's submit: a preference
        Chimmy uses on the next message should not wait for "Save preferences".
      */}
      <ChimmyPreferencesCard />

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={saving}
          className="ns-btn-primary"
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
        <p role="status" aria-live="polite" className="text-sm font-semibold" style={{ color: "#34d399" }}>
          {savedFlash.saved ? "✓ Preferences saved" : ""}
        </p>
      </div>
    </form>
  )
}
