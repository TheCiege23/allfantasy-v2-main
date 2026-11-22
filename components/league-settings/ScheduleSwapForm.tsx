'use client'

/**
 * Swap two teams in one week of the schedule (2026-11-15).
 *
 * Lists the regular-season weeks that have not started, shows the picked week's matchups, and lets the commissioner
 * pick two teams to trade places — each takes the other's opponent, or bye. The server keeps the rules
 * (lib/schedule-runtime/matchupSwapService.ts): a started or playoff week is refused, and the swap is logged for the
 * league. Its answer is shown as it comes back.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'

type Matchup = { id: string; homeRosterId: string; awayRosterId: string | null; homeName: string; awayName: string | null; bye: boolean }
type Week = { week: number; locked: boolean; matchups: Matchup[] }
type ScheduleState = { weeks: Week[]; playoffStartWeek: number | null }

/** Weeks a commissioner may still edit: regular season, not started. Pure. */
export function editableWeeks(state: ScheduleState | null): Week[] {
  if (!state) return []
  return state.weeks.filter((w) => !w.locked && (state.playoffStartWeek == null || w.week < state.playoffStartWeek))
}

export function ScheduleSwapForm({ leagueId }: { leagueId: string }) {
  const { t } = useLanguage()
  const [state, setState] = useState<ScheduleState | null>(null)
  const [week, setWeek] = useState<number | null>(null)
  const [teamA, setTeamA] = useState('')
  const [teamB, setTeamB] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/redraft/schedule?leagueId=${encodeURIComponent(leagueId)}`, { cache: 'no-store' }).catch(() => null)
    const data = res && res.ok ? ((await res.json().catch(() => null)) as { schedule?: ScheduleState } | null) : null
    setState(data?.schedule ?? null)
  }, [leagueId])

  useEffect(() => {
    void load()
  }, [load])

  const weeks = useMemo(() => editableWeeks(state), [state])
  const current = weeks.find((w) => w.week === week) ?? weeks[0] ?? null
  const teams = useMemo(() => {
    if (!current) return [] as Array<{ id: string; name: string }>
    const out: Array<{ id: string; name: string }> = []
    for (const m of current.matchups) {
      out.push({ id: m.homeRosterId, name: m.homeName })
      if (m.awayRosterId) out.push({ id: m.awayRosterId, name: m.awayName ?? m.awayRosterId })
    }
    return out
  }, [current])

  const swap = async () => {
    if (!current || !teamA || !teamB) return
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch('/api/redraft/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId, action: 'swap_teams', week: current.week, rosterA: teamA, rosterB: teamB }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; schedule?: ScheduleState | null }
      if (!res.ok) {
        setMessage({ kind: 'error', text: data.error ?? t('commControl.scheduleFailed') })
        return
      }
      if (data.schedule) setState(data.schedule)
      else await load()
      setTeamA('')
      setTeamB('')
      setMessage({ kind: 'ok', text: t('commControl.swapDone').replace('{{n}}', String(current.week)) })
    } catch {
      setMessage({ kind: 'error', text: t('commControl.scheduleFailed') })
    } finally {
      setBusy(false)
    }
  }

  if (!state) return null
  if (weeks.length === 0) {
    return <p className="text-[12px] text-white/50" data-testid="schedule-swap-none">{t('commControl.swapNoWeeks')}</p>
  }

  const select = 'w-full rounded-lg border border-white/10 bg-[#0a1220] px-3 py-2 text-[12px] text-white'
  return (
    <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-3" data-testid="schedule-swap-form">
      <p className="text-[12px] font-semibold text-white">{t('commControl.swapTitle')}</p>
      <p className="text-[11px] text-white/50">{t('commControl.swapHelp')}</p>
      <select aria-label={t('commControl.swapWeek')} className={select} value={current?.week ?? ''} onChange={(e) => { setWeek(Number(e.target.value)); setTeamA(''); setTeamB('') }}>
        {weeks.map((w) => (
          <option key={w.week} value={w.week}>{t('commControl.swapWeekN').replace('{{n}}', String(w.week))}</option>
        ))}
      </select>
      {current ? (
        <ul className="space-y-1 text-[11px] text-white/65" data-testid="schedule-swap-week">
          {current.matchups.map((m) => (
            <li key={m.id}>{m.awayRosterId ? `${m.homeName} vs ${m.awayName}` : `${m.homeName} — ${t('commControl.swapBye')}`}</li>
          ))}
        </ul>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        {[{ v: teamA, set: setTeamA, label: t('commControl.swapTeamA') }, { v: teamB, set: setTeamB, label: t('commControl.swapTeamB') }].map((f) => (
          <select key={f.label} aria-label={f.label} className={select} value={f.v} onChange={(e) => f.set(e.target.value)}>
            <option value="">{f.label}</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>{team.name}</option>
            ))}
          </select>
        ))}
      </div>
      <button
        type="button"
        data-testid="schedule-swap-submit"
        disabled={busy || !teamA || !teamB || teamA === teamB}
        onClick={() => void swap()}
        className="w-full rounded-lg bg-[#1a2744] px-4 py-2.5 text-[12px] font-bold uppercase tracking-wide text-white hover:bg-[#1e2d52] disabled:opacity-50 border border-white/10"
      >
        {t('commControl.swapButton')}
      </button>
      {message ? (
        <p role={message.kind === 'error' ? 'alert' : 'status'} className={`text-[11px] ${message.kind === 'error' ? 'text-red-300' : 'text-emerald-300'}`}>
          {message.text}
        </p>
      ) : null}
    </div>
  )
}
