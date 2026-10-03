"use client"

import { useState, useEffect } from "react"
import { Check } from "lucide-react"
import ChimmyVoiceSettingsCard from "@/components/settings/ChimmyVoiceSettingsCard"
import ChimmyPreferencesCard from "@/components/settings/ChimmyPreferencesCard"
import AutoCoachSettingsCard from "@/components/settings/AutoCoachSettingsCard"
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

  /*
   * The device's IANA zone, read after mount (Intl is client-only). Login already writes it to the
   * profile (SharedSessionBootstrapService), so it is often a zone the curated signup list does
   * not carry — see `timezoneOptions` below.
   */
  const [deviceTimezone, setDeviceTimezone] = useState<string | null>(null)
  useEffect(() => {
    try {
      setDeviceTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || null)
    } catch {
      setDeviceTimezone(null)
    }
  }, [])

  /*
   * Keyed on the sports' CONTENT, not the array's identity: every profile refetch hands back a new
   * array, which re-ran this effect and wiped unsaved edits to every field here. Profile settled
   * the same problem with its own `sportsKey`.
   */
  const sportsKey = (profile?.preferredSports ?? []).join(",")
  useEffect(() => {
    setTimezone(profile?.timezone ?? "")
    setLang(profile?.preferredLanguage ?? language)
    setTheme(normalizeStoredTheme(profile?.themePreference ?? DEFAULT_THEME))
    const first = profile?.preferredSports?.[0]
    setDefaultSport(isSupportedSport(first) ? first : DEFAULT_SPORT)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sportsKey stands in for preferredSports
  }, [
    profile?.timezone,
    profile?.preferredLanguage,
    profile?.themePreference,
    sportsKey,
    language,
  ])

  /*
   * ⚠ THE CURATED LIST IS 17 NORTH AMERICAN ZONES, BUT THE STORED VALUE CAN BE ANY ZONE. Login
   * saves the browser's zone, so a user in Europe/London had a value the <select> had no option
   * for: it rendered "Select timezone" while the local-time line under it showed London, and the
   * zone could never be picked again once changed. Any zone in play — the saved one, the one being
   * edited, the device's — gets an option of its own.
   */
  const timezoneOptions = (() => {
    const listed = new Set(SIGNUP_TIMEZONES.map((z) => z.value))
    const extra = [profile?.timezone, timezone, deviceTimezone].filter(
      (z, i, all): z is string => Boolean(z) && !listed.has(z as string) && all.indexOf(z) === i,
    )
    return [
      ...extra.map((value) => ({ value, label: `${value.split("/").pop()!.replace(/_/g, " ")} (${value})` })),
      ...SIGNUP_TIMEZONES.map(({ value, label }) => ({ value, label })),
    ]
  })()

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
        <label htmlFor="settings-timezone" className="mb-1 block text-sm font-medium" style={{ color: "var(--muted)" }}>{t("settings.preferences.timezone")}</label>
        <select
          id="settings-timezone"
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
          {timezoneOptions.map((z) => (
            <option key={z.value} value={z.value}>{z.label}</option>
          ))}
        </select>
        {deviceTimezone && deviceTimezone !== timezone ? (
          <button
            type="button"
            onClick={() => {
              savedFlash.clear()
              setTimezone(deviceTimezone)
            }}
            className="mt-2 rounded-lg border px-3 py-1.5 text-xs font-medium"
            style={{ borderColor: "var(--border)", color: "var(--text)" }}
            data-testid="settings-use-device-timezone"
          >
            {tInterpolate("settings.preferences.useDeviceTimezone", { zone: deviceTimezone })}
          </button>
        ) : null}
        {timezone && (
          <p className="mt-1.5 text-xs" style={{ color: "var(--muted2)" }}>
            {tInterpolate("settings.preferences.localTime", {
              time: formatInTimezone(new Date(), timezone, undefined, lang),
            })}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="settings-default-sport" className="mb-1 block text-sm font-medium" style={{ color: "var(--muted)" }}>{t("settings.preferences.defaultSport")}</label>
        <select
          id="settings-default-sport"
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

      {/* Saves on change through /api/user/autocoach, like the Chimmy card above. */}
      <AutoCoachSettingsCard />

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
