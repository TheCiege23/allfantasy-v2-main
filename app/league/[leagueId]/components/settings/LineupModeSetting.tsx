'use client'

import { useEffect, useState } from 'react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { DAILY_LINEUP_LOCK_SPORTS } from '@/lib/redraft/lineupLock'
import { SettingsHelper, SettingsRadioGroup, SettingsSectionLabel } from './settings-ui'

type LineupMode = 'daily' | 'weekly'

/** Server refusal codes (lib/redraft/lineupModeSwitch.ts) → the reader's language. */
const REFUSAL_KEYS: Record<string, string> = {
  lineup_mode_season_in_progress: 'lineupMode.err.seasonInProgress',
  lineup_mode_unavailable: 'lineupMode.err.unavailable',
  lineup_mode_sport_unsupported: 'lineupMode.err.sport',
}

/**
 * "Lineups: Daily / Weekly" for NBA, NHL and MLB leagues. Saves immediately through the settings PATCH
 * (`lineupMode`), which writes both daily-lineup fields together and refuses the switch while a season
 * is under way; the refusal is shown here and the choice reverts. Renders nothing for other sports.
 */
export function LineupModeSetting({
  leagueId,
  sport,
  initialMode,
  canEdit,
}: {
  leagueId: string
  sport: string | null | undefined
  initialMode: LineupMode | null | undefined
  canEdit: boolean
}) {
  const { t } = useLanguage()
  const [mode, setMode] = useState<LineupMode>(initialMode === 'daily' ? 'daily' : 'weekly')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setMode(initialMode === 'daily' ? 'daily' : 'weekly')
  }, [initialMode])

  if (!DAILY_LINEUP_LOCK_SPORTS.includes(String(sport ?? '').toUpperCase())) return null

  const choose = async (next: LineupMode) => {
    if (next === mode || saving) return
    const previous = mode
    setMode(next)
    setError(null)
    setSaving(true)
    try {
      const res = await fetch('/api/league/settings', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId, lineupMode: next }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { code?: string }
        setMode(previous)
        setError(t(REFUSAL_KEYS[data.code ?? ''] ?? 'lineupMode.err.failed'))
      }
    } catch {
      setMode(previous)
      setError(t('lineupMode.err.failed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="px-6 pt-6 text-[13px] text-white/85" data-testid="settings-lineup-mode">
      <SettingsSectionLabel>{t('lineupMode.title')}</SettingsSectionLabel>
      <SettingsRadioGroup<LineupMode>
        name="lineup-mode"
        value={mode}
        disabled={!canEdit || saving}
        onChange={(v) => void choose(v)}
        options={[
          { id: 'weekly', title: t('lineupMode.weekly'), description: t('lineupMode.weeklyDesc') },
          { id: 'daily', title: t('lineupMode.daily'), description: t('lineupMode.dailyDesc') },
        ]}
      />
      <SettingsHelper>{t('lineupMode.helper')}</SettingsHelper>
      {error ? (
        <p className="mt-2 text-[12px] text-red-400" role="alert" data-testid="settings-lineup-mode-error">
          {error}
        </p>
      ) : null}
    </div>
  )
}
