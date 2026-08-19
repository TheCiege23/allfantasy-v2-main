'use client'

import { useMemo, useState } from 'react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { useThemeMode } from '@/components/theme/ThemeProvider'
import { SIGNUP_TIMEZONES, DEFAULT_SIGNUP_TIMEZONE } from '@/lib/signup/timezones'
import { formatInTimezone } from '@/lib/preferences/TimezoneFormattingResolver'

export function UniversalPreferencesHarnessClient() {
  const { language, setLanguage } = useLanguage()
  const { mode, setMode } = useThemeMode()
  const [timezone, setTimezone] = useState(DEFAULT_SIGNUP_TIMEZONE)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  const preview = useMemo(
    () => formatInTimezone('2026-01-15T20:00:00.000Z', timezone),
    [timezone]
  )

  const savePreferences = async () => {
    setSaveStatus('saving')
    try {
      const res = await fetch('/api/user/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preferredLanguage: language,
          themePreference: mode,
          timezone,
        }),
      })
      setSaveStatus(res.ok ? 'saved' : 'error')
    } catch {
      setSaveStatus('error')
    }
  }

  return (
    <main className="min-h-screen px-4 py-6" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
        <h1 className="text-lg font-semibold">Universal preferences click audit harness</h1>

        <section className="rounded-xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}>
          <h2 className="mb-3 text-sm font-semibold">Desktop controls</h2>
          <div className="mb-3 flex items-center gap-2" data-testid="desktop-language-controls">
            <button
              type="button"
              data-testid="desktop-language-en"
              onClick={() => setLanguage('en')}
              className="rounded border px-3 py-1.5 text-xs"
              style={{ borderColor: language === 'en' ? 'var(--accent-cyan)' : 'var(--border)' }}
            >
              English
            </button>
            <button
              type="button"
              data-testid="desktop-language-es"
              onClick={() => setLanguage('es')}
              className="rounded border px-3 py-1.5 text-xs"
              style={{ borderColor: language === 'es' ? 'var(--accent-cyan)' : 'var(--border)' }}
            >
              Espanol
            </button>
          </div>

          <div className="mb-3 flex items-center gap-2" data-testid="desktop-theme-controls">
            {(['light', 'dark', 'legacy'] as const).map((themeId) => (
              <button
                key={themeId}
                type="button"
                data-testid={`desktop-theme-${themeId}`}
                onClick={() => setMode(themeId)}
                className="rounded border px-3 py-1.5 text-xs"
                style={{ borderColor: mode === themeId ? 'var(--accent-cyan)' : 'var(--border)' }}
              >
                {themeId}
              </button>
            ))}
          </div>

          <label className="block text-xs font-medium" htmlFor="desktop-timezone">Timezone</label>
          <select
            id="desktop-timezone"
            data-testid="desktop-timezone"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="mt-1 w-full max-w-sm rounded border px-2 py-1.5 text-xs"
            style={{ borderColor: 'var(--border)', background: 'var(--panel2)', color: 'var(--text)' }}
          >
            {SIGNUP_TIMEZONES.map((tz) => (
              <option key={tz.value} value={tz.value}>
                {tz.label}
              </option>
            ))}
          </select>
        </section>

        <section className="rounded-xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}>
          <h2 className="mb-3 text-sm font-semibold">Mobile quick actions</h2>
          <div className="flex flex-wrap items-center gap-2" data-testid="mobile-quick-actions">
            <button
              type="button"
              data-testid="mobile-language-es"
              onClick={() => setLanguage('es')}
              className="rounded border px-3 py-1.5 text-xs"
              style={{ borderColor: 'var(--border)' }}
            >
              Mobile language es
            </button>
            <button
              type="button"
              data-testid="mobile-theme-dark"
              onClick={() => setMode('dark')}
              className="rounded border px-3 py-1.5 text-xs"
              style={{ borderColor: 'var(--border)' }}
            >
              Mobile theme dark
            </button>
          </div>
        </section>

        <section className="rounded-xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}>
          <div className="text-xs" data-testid="preference-summary-language">language: {language}</div>
          <div className="text-xs" data-testid="preference-summary-theme">theme: {mode}</div>
          <div className="text-xs" data-testid="preference-summary-timezone">timezone: {timezone}</div>
          <div className="text-xs" data-testid="preference-summary-preview">preview: {preview}</div>

          <button
            type="button"
            data-testid="save-preferences"
            onClick={savePreferences}
            className="mt-3 rounded border px-3 py-1.5 text-xs"
            style={{ borderColor: 'var(--border)' }}
          >
            Save universal preferences
          </button>
          <div className="mt-2 text-xs" data-testid="preference-save-status">{saveStatus}</div>
        </section>
      </div>
    </main>
  )
}
