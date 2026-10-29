'use client'

import { useState } from 'react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { regenerateRedraftSchedule } from '@/lib/redraft/client'
// Leaf module: the wire constants only, no prisma (see the note in WeekControlPanel).
import { SCHEDULE_REGEN_CONFIRMATION_CODE } from '@/lib/schedule-runtime/scheduleRegeneration'

/**
 * Commissioner "Regenerate schedule" control, for every league the weekly season runs — NFL
 * redraft, dynasty (including a year-2+ season) and NBA/NHL/MLB alike.
 *
 * The route rebuilds only the weeks that have not started. Once a week has started it answers
 * `mid_season_confirmation_required`, and this panel asks before re-sending with the flag — the
 * same contract as the mid-season scoring/roster editors.
 */
const REFUSAL_KEYS: Record<string, string> = {
  DRAFT_IN_PROGRESS: 'schedRegen.err.draft',
  LEAGUE_ARCHIVED: 'schedRegen.err.archived',
  NO_REGENERABLE_WEEKS: 'schedRegen.err.noWeeks',
}

export function ScheduleRegeneratePanel({
  seasonId,
  onChanged,
}: {
  seasonId: string
  onChanged?: () => void
}) {
  const { t, tInterpolate } = useOptionalLanguage()
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null)

  async function run(confirmMidSeasonChange: boolean) {
    setBusy(true)
    setMessage(null)
    try {
      const result = await regenerateRedraftSchedule({ seasonId, confirmMidSeasonChange })
      if (result.ok) {
        setConfirming(false)
        const done = tInterpolate('schedRegen.done', { week: result.regeneratedFromWeek ?? 1 })
        setMessage({ tone: 'ok', text: [done, ...(result.warnings ?? [])].join(' ') })
        onChanged?.()
        return
      }
      if (result.code === SCHEDULE_REGEN_CONFIRMATION_CODE && !confirmMidSeasonChange) {
        setConfirming(true)
        return
      }
      setConfirming(false)
      const key = result.code ? REFUSAL_KEYS[result.code] : undefined
      setMessage({ tone: 'warn', text: key ? t(key) : result.error || t('schedRegen.err.generic') })
    } catch {
      setMessage({ tone: 'warn', text: t('schedRegen.err.generic') })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      className="mb-4 rounded-lg border border-[color:var(--border-subtle,#2a2a2a)] bg-[color:var(--surface-1,#141414)] p-4"
      data-testid="schedule-regenerate-panel"
      aria-label={t('schedRegen.title')}
    >
      <h3 className="text-sm font-bold uppercase tracking-wide">{t('schedRegen.title')}</h3>
      <p className="mt-1 text-xs text-[color:var(--text-secondary,#b4b4b4)]">{t('schedRegen.body')}</p>

      {confirming ? (
        <div role="alertdialog" aria-label={t('schedRegen.confirmTitle')} className="mt-3 rounded-md border border-amber-500/40 p-3">
          <p className="text-sm font-semibold">{t('schedRegen.confirmTitle')}</p>
          <p className="mt-1 text-xs">{t('schedRegen.confirmBody')}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="min-h-11 rounded-md border border-amber-500/60 px-3 text-sm font-semibold disabled:opacity-50"
              disabled={busy}
              onClick={() => void run(true)}
            >
              {busy ? t('schedRegen.working') : t('schedRegen.confirm')}
            </button>
            <button
              type="button"
              className="min-h-11 rounded-md border border-[color:var(--border-subtle,#2a2a2a)] px-3 text-sm disabled:opacity-50"
              disabled={busy}
              onClick={() => {
                setConfirming(false)
                setMessage({ tone: 'warn', text: t('schedRegen.cancelled') })
              }}
            >
              {t('schedRegen.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="mt-3 min-h-11 rounded-md border border-[color:var(--border-subtle,#2a2a2a)] px-3 text-sm font-semibold disabled:opacity-50"
          disabled={busy}
          onClick={() => void run(false)}
        >
          {busy ? t('schedRegen.working') : t('schedRegen.button')}
        </button>
      )}

      {message ? (
        <p role="status" className={`mt-3 text-sm ${message.tone === 'ok' ? 'text-emerald-400' : 'text-amber-300'}`}>
          {message.text}
        </p>
      ) : null}
    </section>
  )
}
