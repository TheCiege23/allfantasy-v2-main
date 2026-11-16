'use client'

/**
 * Rivalry week (2026-11-15): pick a week that has not started, preview each team's rival and the facts behind the
 * rivalry, then apply. The server pairs from the league's rivalry history and keeps the rules
 * (lib/schedule-runtime/rivalryWeekService.ts); its answer is shown as it comes back.
 */
import { useCallback, useEffect, useState } from 'react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { editableWeeks } from '@/components/league-settings/ScheduleSwapForm'

type Pair = {
  homeRosterId: string
  awayRosterId: string | null
  homeName: string
  awayName: string | null
  rivalry: boolean
  reasons: string[]
  context: string | null
}
type ScheduleState = Parameters<typeof editableWeeks>[0]

export function RivalryWeekCard({ leagueId }: { leagueId: string }) {
  const { t } = useLanguage()
  const [schedule, setSchedule] = useState<ScheduleState>(null)
  const [week, setWeek] = useState<number | null>(null)
  const [pairs, setPairs] = useState<Pair[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  useEffect(() => {
    let active = true
    fetch(`/api/redraft/schedule?leagueId=${encodeURIComponent(leagueId)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { schedule?: ScheduleState } | null) => { if (active) setSchedule(d?.schedule ?? null) })
      .catch(() => { if (active) setSchedule(null) })
    return () => { active = false }
  }, [leagueId])

  const weeks = editableWeeks(schedule)
  const chosen = week ?? weeks[0]?.week ?? null

  const send = useCallback(
    async (apply: boolean) => {
      if (chosen == null) return
      setBusy(true)
      setMessage(null)
      try {
        const res = await fetch('/api/redraft/schedule', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ leagueId, action: apply ? 'rivalry_week_apply' : 'rivalry_week_preview', week: chosen }),
        })
        const data = (await res.json().catch(() => ({}))) as { error?: string; pairs?: Pair[] }
        if (!res.ok) {
          setPairs(null)
          setMessage({ kind: 'error', text: data.error ?? t('commControl.scheduleFailed') })
          return
        }
        setPairs(data.pairs ?? [])
        if (apply) setMessage({ kind: 'ok', text: t('commControl.rivalryApplied').replace('{{n}}', String(chosen)) })
      } catch {
        setMessage({ kind: 'error', text: t('commControl.scheduleFailed') })
      } finally {
        setBusy(false)
      }
    },
    [chosen, leagueId, t],
  )

  if (!schedule || weeks.length === 0) return null

  const button = 'rounded-lg px-4 py-2.5 text-[12px] font-bold uppercase tracking-wide border border-white/10 disabled:opacity-50'
  return (
    <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-3" data-testid="rivalry-week-card">
      <p className="text-[12px] font-semibold text-white">{t('commControl.rivalryTitle')}</p>
      <p className="text-[11px] text-white/50">{t('commControl.rivalryHelp')}</p>
      <select
        aria-label={t('commControl.swapWeek')}
        className="w-full rounded-lg border border-white/10 bg-[#0a1220] px-3 py-2 text-[12px] text-white"
        value={chosen ?? ''}
        onChange={(e) => { setWeek(Number(e.target.value)); setPairs(null); setMessage(null) }}
      >
        {weeks.map((w) => (
          <option key={w.week} value={w.week}>{t('commControl.swapWeekN').replace('{{n}}', String(w.week))}</option>
        ))}
      </select>
      <button type="button" data-testid="rivalry-week-preview" disabled={busy} onClick={() => void send(false)} className={`w-full bg-[#1a2744] text-white ${button}`}>
        {t('commControl.rivalryPreview')}
      </button>
      {pairs ? (
        <ul className="space-y-2" data-testid="rivalry-week-pairs">
          {pairs.map((p) => (
            <li key={`${p.homeRosterId}-${p.awayRosterId ?? 'bye'}`} className="rounded-lg border border-white/10 px-3 py-2 text-[12px] text-white/85">
              <span className="font-semibold">{p.awayName ? `${p.homeName} vs ${p.awayName}` : `${p.homeName} — ${t('commControl.swapBye')}`}</span>
              {p.rivalry && p.reasons.length > 0 ? <p className="mt-1 text-[11px] text-white/55">{p.reasons.join(' · ')}</p> : null}
              {p.rivalry && p.context ? <p className="text-[11px] text-white/45">{p.context}</p> : null}
              {!p.rivalry && p.awayName ? <p className="mt-1 text-[11px] text-white/40">{t('commControl.rivalryNoHistory')}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {pairs && !message ? (
        <button type="button" data-testid="rivalry-week-apply" disabled={busy} onClick={() => void send(true)} className={`w-full bg-amber-600/30 text-amber-100 ${button}`}>
          {t('commControl.rivalryApply').replace('{{n}}', String(chosen))}
        </button>
      ) : null}
      {message ? (
        <p role={message.kind === 'error' ? 'alert' : 'status'} className={`text-[11px] ${message.kind === 'error' ? 'text-red-300' : 'text-emerald-300'}`}>
          {message.text}
        </p>
      ) : null}
    </div>
  )
}
