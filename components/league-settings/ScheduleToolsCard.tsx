'use client'

/**
 * Commissioner Hub › Schedule (owner's page review #17, Phase C3): randomize the schedule N times with
 * every draw posted to the league chat, and set a week's matchups by hand.
 *
 * The server keeps every rule (lib/schedule-runtime/scheduleToolsService.ts): started weeks never change,
 * a mid-season rebuild asks first, and custom weeks keep their matchups through every rebuild. Its answer
 * is shown as it comes back.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { editableWeeks } from '@/components/league-settings/ScheduleSwapForm'
import { MAX_SCHEDULE_RANDOMIZATIONS, checkCustomPairs, type CustomPair } from '@/lib/schedule-runtime/customWeeks'

type Matchup = { id: string; homeRosterId: string; awayRosterId: string | null; homeName: string; awayName: string | null; bye: boolean }
type Week = { week: number; locked: boolean; matchups: Matchup[] }
type ScheduleState = { weeks: Week[]; playoffStartWeek: number | null }
type Message = { kind: 'ok' | 'error'; text: string } | null

const MID_SEASON = 'mid_season_confirmation_required'

const box = 'space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-3'
const button = 'min-h-[40px] rounded-lg px-4 text-[12px] font-bold uppercase tracking-wide border border-white/10 disabled:opacity-50'
const select = 'min-h-[40px] w-full rounded-lg border border-white/10 bg-[#0a1220] px-3 text-[13px] text-white'

export function ScheduleToolsCard({ leagueId, onChanged }: { leagueId: string; onChanged?: () => void }) {
  const { t } = useLanguage()
  const [state, setState] = useState<ScheduleState | null>(null)
  const [customWeeks, setCustomWeeks] = useState<number[]>([])
  const [times, setTimes] = useState(5)
  const [busy, setBusy] = useState<'randomize' | 'custom' | null>(null)
  const [randomMsg, setRandomMsg] = useState<Message>(null)
  const [customMsg, setCustomMsg] = useState<Message>(null)
  const [week, setWeek] = useState<number | null>(null)
  const [pairs, setPairs] = useState<CustomPair[]>([])

  const load = useCallback(async () => {
    const res = await fetch(`/api/redraft/schedule?leagueId=${encodeURIComponent(leagueId)}`, { cache: 'no-store' }).catch(() => null)
    const data = res && res.ok ? ((await res.json().catch(() => null)) as { schedule?: ScheduleState; customWeeks?: number[] } | null) : null
    setState(data?.schedule ?? null)
    setCustomWeeks(Array.isArray(data?.customWeeks) ? data!.customWeeks! : [])
  }, [leagueId])

  useEffect(() => {
    void load()
  }, [load])

  const weeks = useMemo(() => editableWeeks(state), [state])
  const current = weeks.find((w) => w.week === week) ?? weeks[0] ?? null
  const teams = useMemo(() => {
    const out: Array<{ id: string; name: string }> = []
    for (const m of current?.matchups ?? []) {
      out.push({ id: m.homeRosterId, name: m.homeName })
      if (m.awayRosterId) out.push({ id: m.awayRosterId, name: m.awayName ?? m.awayRosterId })
    }
    return out
  }, [current])
  const odd = teams.length % 2 === 1

  // The editor starts from the week as it stands.
  useEffect(() => {
    setPairs((current?.matchups ?? []).map((m) => ({ home: m.homeRosterId, away: m.awayRosterId })))
    setCustomMsg(null)
  }, [current])

  const post = async (body: Record<string, unknown>) => {
    const res = await fetch('/api/redraft/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leagueId, ...body }),
    })
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
    return { ok: res.ok, data }
  }

  const randomize = async () => {
    setBusy('randomize')
    setRandomMsg(null)
    try {
      let out = await post({ action: 'randomize', times })
      if (!out.ok && out.data.code === MID_SEASON) {
        // Weeks that have started stay; the server asks before rebuilding the rest mid-season.
        if (!window.confirm(String(out.data.error ?? ''))) return
        out = await post({ action: 'randomize', times, confirmMidSeasonChange: true })
      }
      if (!out.ok) {
        setRandomMsg({ kind: 'error', text: String(out.data.error ?? t('commControl.scheduleFailed')) })
        return
      }
      setRandomMsg({
        kind: 'ok',
        text: t('commControl.randomizeDone').replace('{{n}}', String(out.data.posted ?? times)).replace('{{w}}', String(out.data.regeneratedFromWeek ?? 1)),
      })
      await load()
      onChanged?.()
    } catch {
      setRandomMsg({ kind: 'error', text: t('commControl.scheduleFailed') })
    } finally {
      setBusy(null)
    }
  }

  const check = useMemo(() => checkCustomPairs(pairs, teams.map((x) => x.id)), [pairs, teams])

  const saveWeek = async (clear: boolean) => {
    if (!current) return
    setBusy('custom')
    setCustomMsg(null)
    try {
      const out = await post(clear ? { action: 'clear_custom_week', week: current.week } : { action: 'set_custom_week', week: current.week, pairs })
      if (!out.ok) {
        setCustomMsg({ kind: 'error', text: String(out.data.error ?? t('commControl.scheduleFailed')) })
        return
      }
      setCustomMsg({ kind: 'ok', text: t(clear ? 'commControl.customCleared' : 'commControl.customSaved').replace('{{n}}', String(current.week)) })
      await load()
      onChanged?.()
    } catch {
      setCustomMsg({ kind: 'error', text: t('commControl.scheduleFailed') })
    } finally {
      setBusy(null)
    }
  }

  const setPair = (i: number, side: 'home' | 'away', value: string) =>
    setPairs((ps) => ps.map((p, j) => (j === i ? { ...p, [side]: side === 'away' && value === '' ? null : value } : p)))

  if (!state || weeks.length === 0) return null
  const isCustom = current ? customWeeks.includes(current.week) : false
  const msg = (m: Message) =>
    m ? (
      <div role={m.kind === 'error' ? 'alert' : 'status'} className={`rounded-lg border px-3 py-2 text-[12px] ${m.kind === 'ok' ? 'border-emerald-500/20 bg-emerald-950/20 text-emerald-300' : 'border-red-500/20 bg-red-950/20 text-red-300'}`}>
        {m.text}
      </div>
    ) : null

  return (
    <div className="space-y-3" data-testid="schedule-tools">
      <section className={box} aria-labelledby="sched-rand-title" data-testid="schedule-randomize">
        <p id="sched-rand-title" className="text-[13px] font-semibold text-white">{t('commControl.randomizeTitle')}</p>
        <p className="text-[12px] leading-relaxed text-white/55">{t('commControl.randomizeHelp')}</p>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[13px] font-semibold text-white/80">{t('commControl.randomizeTimes')}</span>
          <button type="button" aria-label={t('commControl.randomizeFewer')} onClick={() => setTimes((n) => Math.max(1, n - 1))} disabled={times <= 1} className="h-10 w-10 rounded-full border border-white/15 text-[18px] font-bold text-white disabled:opacity-40">−</button>
          <span className="min-w-[2.5ch] text-center text-[20px] font-black text-white" data-testid="schedule-randomize-count" aria-live="polite">{times}</span>
          <button type="button" aria-label={t('commControl.randomizeMore')} onClick={() => setTimes((n) => Math.min(MAX_SCHEDULE_RANDOMIZATIONS, n + 1))} disabled={times >= MAX_SCHEDULE_RANDOMIZATIONS} className="h-10 w-10 rounded-full border border-white/15 text-[18px] font-bold text-white disabled:opacity-40">+</button>
          <span className="text-[12px] text-white/40">1–{MAX_SCHEDULE_RANDOMIZATIONS}</span>
        </div>
        <button type="button" onClick={() => void randomize()} disabled={busy !== null} className={`${button} bg-cyan-500/15 text-cyan-200`} data-testid="schedule-randomize-run">
          {times === 1 ? t('commControl.randomizeRunOnce') : t('commControl.randomizeRun').replace('{{n}}', String(times))}
        </button>
        {msg(randomMsg)}
      </section>

      <section className={box} aria-labelledby="sched-custom-title" data-testid="schedule-custom-week">
        <p id="sched-custom-title" className="text-[13px] font-semibold text-white">{t('commControl.customTitle')}</p>
        <p className="text-[12px] leading-relaxed text-white/55">{t('commControl.customHelp')}</p>
        <select aria-label={t('commControl.swapWeek')} className={select} value={current?.week ?? ''} onChange={(e) => setWeek(Number(e.target.value))} data-testid="schedule-custom-week-select">
          {weeks.map((w) => (
            <option key={w.week} value={w.week}>
              {`${t('commControl.swapWeek')} ${w.week}${customWeeks.includes(w.week) ? ` · ${t('commControl.customTag')}` : ''}`}
            </option>
          ))}
        </select>
        <div className="space-y-2">
          {pairs.map((p, i) => (
            <div key={i} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2" data-testid="schedule-custom-pair">
              <select aria-label={`${t('commControl.customTeam')} ${i + 1}`} className={select} value={p.home} onChange={(e) => setPair(i, 'home', e.target.value)}>
                {teams.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
              <span className="text-[12px] font-bold text-white/40">vs</span>
              <select aria-label={`${t('commControl.customOpponent')} ${i + 1}`} className={select} value={p.away ?? ''} onChange={(e) => setPair(i, 'away', e.target.value)}>
                {odd ? <option value="">{t('commControl.customBye')}</option> : null}
                {teams.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </div>
          ))}
        </div>
        {!check.ok ? <p role="alert" className="text-[12px] text-amber-300" data-testid="schedule-custom-invalid">{t(`commControl.customErr.${check.code}`)}</p> : null}
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void saveWeek(false)} disabled={busy !== null || !check.ok} className={`${button} bg-cyan-500/15 text-cyan-200`} data-testid="schedule-custom-save">
            {t('commControl.customSave').replace('{{n}}', String(current?.week ?? ''))}
          </button>
          {isCustom ? (
            <button type="button" onClick={() => void saveWeek(true)} disabled={busy !== null} className={`${button} text-white/70`} data-testid="schedule-custom-clear">
              {t('commControl.customClear')}
            </button>
          ) : null}
        </div>
        {msg(customMsg)}
      </section>
    </div>
  )
}

export default ScheduleToolsCard
