'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { hubCopy } from '@/lib/core-app/commissionerHubCopy'

/**
 * The waiver budget of an imported league whose platform's import records none (Fantrax, Yahoo) — Commissioner →
 * Trades and draft archive. The trade grader prices a budget move against it; until it is set, budget in a trade
 * reads as not graded rather than being priced against a stand-in. Saves through `PUT /api/leagues/[id]/waiver-budget`,
 * which re-checks the commissioner.
 */
export function WaiverBudgetControl({ leagueId, initial }: { leagueId: string; initial: number | null }) {
  const router = useRouter()
  const { language } = useOptionalLanguage()
  const t = (english: string) => hubCopy(english, language)
  const [value, setValue] = useState(initial != null ? String(initial) : '')
  const [saved, setSaved] = useState<number | null>(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/waiver-budget`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ waiverBudget: Number(value.replace(/[,\s$]/g, '')) }),
      })
      const body = (await res.json().catch(() => null)) as { waiverBudget?: number; error?: string } | null
      if (!res.ok || typeof body?.waiverBudget !== 'number') {
        setError(body?.error ?? 'The budget was not saved. Nothing was changed.')
        return
      }
      setSaved(body.waiverBudget)
      setValue(String(body.waiverBudget))
      router.refresh()
    } catch {
      setError('Could not reach the server. Nothing was changed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="af-ch-waiver-budget">
      <h3>{t('Waiver budget')}</h3>
      <p className="af-ch-muted">
        {t('Your platform does not send AllFantasy the waiver budget. Enter the budget each team starts the season with, so trades that moved budget can be graded.')}
      </p>
      <p>
        {saved != null ? t(`Set to ${saved.toLocaleString('en-US')}.`) : t('Not set: a trade that moved budget shows as not graded.')}
      </p>
      <label>
        <span className="af-ch-muted">{t('Budget per team')}</span>{' '}
        <input
          type="text"
          inputMode="numeric"
          value={value}
          disabled={busy}
          onChange={(e) => setValue(e.target.value)}
          aria-label={t('Budget per team')}
        />
      </label>{' '}
      <button type="button" className="af-btn af-ch-publish-btn" disabled={busy || !value.trim()} onClick={() => void save()}>
        {busy ? t('Saving…') : t('Save budget')}
      </button>
      {error ? <p className="af-ch-publish-error" role="alert">{t(error)}</p> : null}
    </div>
  )
}
