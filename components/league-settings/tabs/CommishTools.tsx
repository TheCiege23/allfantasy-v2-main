'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { HubCard } from './hubFields'
import { fitsSlot } from '@/lib/league/lineup-expand-template'

type WaiverTeam = { rosterId: string; name: string; faabRemaining: number | null; waiverPriority: number | null }

/**
 * Edit Waiver: FAAB left and claim priority for every team. Commish or co-commish.
 * Edits are held locally and saved together, because priorities must stay a 1..N permutation —
 * swapping two teams is two edits that are only valid as a pair.
 */
export function EditWaiversCard({ leagueId }: { leagueId: string }) {
  const { t } = useLanguage()
  const [teams, setTeams] = useState<WaiverTeam[] | null>(null)
  const [budget, setBudget] = useState<number | null>(null)
  const [draft, setDraft] = useState<Record<string, { faab: string; priority: string }>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const url = `/api/leagues/${encodeURIComponent(leagueId)}/commish-waivers`

  const apply = useCallback((data: { teams: WaiverTeam[]; faabBudget: number | null }) => {
    setTeams(data.teams)
    setBudget(data.faabBudget)
    setDraft(
      Object.fromEntries(
        data.teams.map((tm) => [tm.rosterId, { faab: String(tm.faabRemaining ?? ''), priority: String(tm.waiverPriority ?? '') }]),
      ),
    )
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch(url, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => !cancelled && apply(d))
      .catch(() => !cancelled && setError(t('lsHub.ct.loadFailed')))
    return () => {
      cancelled = true
    }
  }, [url, apply, t])

  const changed = (teams ?? []).filter((tm) => {
    const d = draft[tm.rosterId]
    return d && (d.faab !== String(tm.faabRemaining ?? '') || d.priority !== String(tm.waiverPriority ?? ''))
  })

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const updates = changed.map((tm) => {
        const d = draft[tm.rosterId]!
        return {
          rosterId: tm.rosterId,
          ...(d.faab !== String(tm.faabRemaining ?? '') ? { faabRemaining: Number(d.faab) } : {}),
          ...(d.priority !== String(tm.waiverPriority ?? '') ? { waiverPriority: Number(d.priority) } : {}),
        }
      })
      const res = await fetch(url, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : t('lsHub.sp.saveFailed'))
        return
      }
      apply(data)
      toast.success(t('lsHub.ct.saved'))
    } catch {
      setError(t('lsHub.sp.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const input =
    'w-16 rounded-lg border border-white/[0.12] bg-black/30 px-2 py-1.5 text-center text-[13px] text-white outline-none focus:border-cyan-400/40'

  return (
    <HubCard title={t('lsHub.ct.waivers')} testId="commish-edit-waivers">
      <p className="text-[12px] text-white/50">{t('lsHub.ct.waiversHint')}</p>
      {teams == null ? (
        error ? <p className="text-[12px] text-red-300/85">{error}</p> : <div className="h-24 animate-pulse rounded-xl bg-white/[0.05]" />
      ) : (
        <>
          <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-3 gap-y-2 text-[12px]">
            <span className="text-[11px] font-bold uppercase tracking-wide text-white/40">{t('lsHub.ct.team')}</span>
            <span className="w-16 text-center text-[11px] font-bold uppercase tracking-wide text-white/40">{t('lsHub.ct.priority')}</span>
            <span className="w-16 text-center text-[11px] font-bold uppercase tracking-wide text-white/40">FAAB</span>
            {teams.map((tm) => (
              <div key={tm.rosterId} className="contents">
                <span className="truncate text-[13px] text-white/85">{tm.name}</span>
                <input
                  inputMode="numeric"
                  aria-label={`${tm.name} ${t('lsHub.ct.priority')}`}
                  className={input}
                  value={draft[tm.rosterId]?.priority ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, [tm.rosterId]: { ...d[tm.rosterId]!, priority: e.target.value.replace(/\D/g, '') } }))}
                />
                <input
                  inputMode="numeric"
                  aria-label={`${tm.name} FAAB`}
                  className={input}
                  value={draft[tm.rosterId]?.faab ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, [tm.rosterId]: { ...d[tm.rosterId]!, faab: e.target.value.replace(/\D/g, '') } }))}
                />
              </div>
            ))}
          </div>
          {budget != null ? <p className="text-[11px] text-white/40">{t('lsHub.ct.budget').replace('{{n}}', String(budget))}</p> : null}
          {error ? <p className="text-[12px] text-amber-200/85" role="alert">{error}</p> : null}
          <button
            type="button"
            disabled={saving || changed.length === 0}
            onClick={() => void save()}
            className="rounded-lg bg-cyan-500/90 px-4 py-2 text-[12px] font-extrabold text-[#04131a] disabled:opacity-40"
            data-testid="commish-edit-waivers-save"
          >
            {saving ? t('lsHub.saving') : t('lsHub.ct.save')}
          </button>
        </>
      )}
    </HubCard>
  )
}

/** Hand the head-commish role to another manager. Head commish only (the route enforces it). */
export function TransferCommishCard({ leagueId }: { leagueId: string }) {
  const { t } = useLanguage()
  const router = useRouter()
  const [candidates, setCandidates] = useState<Array<{ userId: string; name: string }> | null>(null)
  const [pick, setPick] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const url = `/api/commissioner/leagues/${encodeURIComponent(leagueId)}/transfer`

  useEffect(() => {
    let cancelled = false
    fetch(url, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { candidates: [] }))
      .then((d: { candidates?: Array<{ userId: string; name: string }> }) => !cancelled && setCandidates(d.candidates ?? []))
      .catch(() => !cancelled && setCandidates([]))
    return () => {
      cancelled = true
    }
  }, [url])

  const transfer = async () => {
    setBusy(true)
    try {
      const res = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newCommissionerUserId: pick, confirm: true }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(typeof data.error === 'string' ? data.error : t('lsHub.ct.transferFailed'))
        return
      }
      toast.success(t('lsHub.ct.transferred'))
      router.refresh()
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  const name = candidates?.find((c) => c.userId === pick)?.name ?? ''
  return (
    <HubCard title={t('lsHub.ct.transfer')} testId="commish-transfer">
      <p className="text-[12px] text-white/50">{t('lsHub.ct.transferHint')}</p>
      {candidates == null ? (
        <div className="h-10 animate-pulse rounded-xl bg-white/[0.05]" />
      ) : candidates.length === 0 ? (
        <p className="text-[12px] text-white/50">{t('lsHub.ct.noCandidates')}</p>
      ) : (
        <>
          <select
            value={pick}
            onChange={(e) => {
              setPick(e.target.value)
              setConfirming(false)
            }}
            className="w-full rounded-xl border border-white/[0.10] bg-black/25 px-3 py-2.5 text-sm text-white"
            data-testid="commish-transfer-select"
          >
            <option value="" className="bg-[#0d1117]">{t('lsHub.ct.choose')}</option>
            {candidates.map((c) => (
              <option key={c.userId} value={c.userId} className="bg-[#0d1117]">
                {c.name}
              </option>
            ))}
          </select>
          {confirming ? (
            <div className="rounded-xl border border-amber-300/25 bg-amber-950/25 p-3">
              <p className="text-[12px] text-amber-100/90">{t('lsHub.ct.transferConfirm').replace('{{name}}', name)}</p>
              <div className="mt-2 flex gap-2">
                <button type="button" disabled={busy} onClick={() => void transfer()} className="rounded-lg bg-amber-400/90 px-3.5 py-2 text-[12px] font-extrabold text-[#1a1204] disabled:opacity-50">
                  {t('lsHub.ct.transferButton')}
                </button>
                <button type="button" disabled={busy} onClick={() => setConfirming(false)} className="rounded-lg px-3.5 py-2 text-[12px] font-semibold text-white/60">
                  {t('lsHub.sp.cancel')}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              disabled={!pick}
              onClick={() => setConfirming(true)}
              className="rounded-lg border border-white/15 bg-white/[0.06] px-4 py-2 text-[12px] font-bold text-white/90 disabled:opacity-40"
            >
              {t('lsHub.ct.transferButton')}
            </button>
          )}
        </>
      )}
    </HubCard>
  )
}

/** Reset League: clears claims, transactions, standings and the draft session; keeps rosters and members. */
export function ResetLeagueCard({ leagueId, leagueName }: { leagueId: string; leagueName: string }) {
  const { t } = useLanguage()
  const [mode, setMode] = useState<'soft' | 'full'>('soft')
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const ready = typed.trim() === leagueName.trim()

  const reset = async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/reset`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(typeof data.error === 'string' ? data.error : t('lsHub.ct.resetFailed'))
        return
      }
      toast.success(t('lsHub.ct.resetDone'))
      setTyped('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-2xl border border-orange-400/25 bg-orange-950/15 p-4" data-testid="commish-reset-league">
      <h3 className="text-[13px] font-bold uppercase tracking-wide text-orange-200">{t('lsHub.ct.reset')}</h3>
      <p className="mt-1.5 text-[12px] leading-relaxed text-white/60">{t('lsHub.ct.resetHint')}</p>
      <div className="mt-3 flex flex-wrap gap-1.5" role="radiogroup" aria-label={t('lsHub.ct.reset')}>
        {(['soft', 'full'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            onClick={() => setMode(m)}
            className={`rounded-full border px-3 py-1.5 text-[12px] font-semibold ${
              mode === m ? 'border-orange-300/60 bg-orange-500/15 text-orange-100' : 'border-white/[0.10] text-white/60'
            }`}
          >
            {t(m === 'soft' ? 'lsHub.ct.resetSoft' : 'lsHub.ct.resetFull')}
          </button>
        ))}
      </div>
      <label className="mt-3 block">
        <span className="mb-1 block text-[11px] text-white/50">{t('lsHub.ct.resetType').replace('{{name}}', leagueName)}</span>
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          className="w-full rounded-xl border border-white/[0.10] bg-black/25 px-3 py-2 text-sm text-white"
          data-testid="commish-reset-confirm-input"
        />
      </label>
      <button
        type="button"
        disabled={!ready || busy}
        onClick={() => void reset()}
        className="mt-3 rounded-lg border border-orange-400/40 bg-orange-500/15 px-4 py-2 text-[12px] font-extrabold text-orange-100 disabled:opacity-40"
        data-testid="commish-reset-button"
      >
        {busy ? t('lsHub.saving') : t('lsHub.ct.resetButton')}
      </button>
    </section>
  )
}

type ScoreTeam = { rosterId: string; name: string; record: string } | null
type ScoreRow = {
  matchupId: string
  home: ScoreTeam
  away: ScoreTeam
  homeScore: number
  awayScore: number | null
  status: string
  editedByCommish: boolean
}
type ScoresPayload = { season: number; currentWeek: number; weeks: number[]; week: number | null; matchups: ScoreRow[] }

/**
 * Edit Matchup Scores: past regular-season weeks only. Saving writes the scores and rebuilds every
 * record (W/L/T, points for/against, streaks, seeds, median game) in one step, so standings can never
 * sit out of date between "edit" and "recalculate".
 */
export function EditMatchupScoresCard({ leagueId }: { leagueId: string }) {
  const { t } = useLanguage()
  const [data, setData] = useState<ScoresPayload | null>(null)
  const [draft, setDraft] = useState<Record<string, { home: string; away: string }>>({})
  const [status, setStatus] = useState<'loading' | 'ready' | 'none' | 'error'>('loading')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const base = `/api/leagues/${encodeURIComponent(leagueId)}/commish-scores`

  const apply = useCallback((d: ScoresPayload) => {
    setData(d)
    setDraft(
      Object.fromEntries(
        d.matchups.map((m) => [m.matchupId, { home: String(m.homeScore), away: m.awayScore == null ? '' : String(m.awayScore) }]),
      ),
    )
    setStatus(d.weeks.length === 0 ? 'none' : 'ready')
  }, [])

  const load = useCallback(
    async (week?: number) => {
      setError(null)
      try {
        const res = await fetch(week ? `${base}?week=${week}` : base, { credentials: 'include' })
        if (res.status === 404) {
          setStatus('none')
          return
        }
        if (!res.ok) throw new Error(String(res.status))
        apply((await res.json()) as ScoresPayload)
      } catch {
        setStatus('error')
      }
    },
    [base, apply],
  )

  useEffect(() => {
    void load()
  }, [load])

  const changed = (data?.matchups ?? []).filter((m) => {
    const d = draft[m.matchupId]
    return d && (Number(d.home) !== m.homeScore || (m.away != null && Number(d.away) !== m.awayScore))
  })

  const save = async () => {
    if (!data?.week) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(base, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          week: data.week,
          scores: changed.map((m) => ({
            matchupId: m.matchupId,
            homeScore: Number(draft[m.matchupId]!.home),
            ...(m.away ? { awayScore: Number(draft[m.matchupId]!.away) } : {}),
          })),
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof body.error === 'string' ? body.error : t('lsHub.sp.saveFailed'))
        return
      }
      toast.success(t('lsHub.ms.saved').replace('{{week}}', String(data.week)))
      await load(data.week)
    } catch {
      setError(t('lsHub.sp.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const scoreInput =
    'w-20 rounded-full border border-cyan-400/40 bg-black/30 px-2 py-1.5 text-center text-[13px] font-semibold text-cyan-100 outline-none focus:border-cyan-300'
  const clean = (v: string) => v.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1')

  return (
    <HubCard title={t('lsHub.ms.title')} testId="commish-edit-scores">
      <p className="text-[12px] text-white/50">{t('lsHub.ms.hint')}</p>
      {status === 'loading' ? (
        <div className="h-24 animate-pulse rounded-xl bg-white/[0.05]" />
      ) : status === 'none' ? (
        <p className="text-[12px] text-white/50">{t('lsHub.ms.none')}</p>
      ) : status === 'error' || !data ? (
        <p className="text-[12px] text-red-300/85">{t('lsHub.ct.loadFailed')}</p>
      ) : (
        <>
          <div className="scrollbar-none flex gap-1.5 overflow-x-auto pb-1" role="radiogroup" aria-label={t('lsHub.ms.selectWeek')}>
            {[...data.weeks].reverse().map((w) => (
              <button
                key={w}
                type="button"
                role="radio"
                aria-checked={w === data.week}
                onClick={() => void load(w)}
                className={`flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-full border text-[11px] leading-tight transition ${
                  w === data.week ? 'border-cyan-300 bg-cyan-400 text-[#04131a]' : 'border-white/[0.12] bg-white/[0.06] text-white/70'
                }`}
              >
                <span>{t('lsHub.ms.wk')}</span>
                <span className="text-[15px] font-bold">{w}</span>
              </button>
            ))}
          </div>
          <ul className="divide-y divide-white/[0.06] rounded-2xl border border-white/[0.08] bg-black/20" data-testid="commish-edit-scores-list">
            {data.matchups.map((m) => (
              <li key={m.matchupId} className="space-y-2 px-3 py-3">
                {[
                  { side: 'home' as const, team: m.home },
                  { side: 'away' as const, team: m.away },
                ].map(({ side, team }) =>
                  team ? (
                    <div key={side} className="flex items-center justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-semibold text-white">{team.name}</span>
                        <span className="text-[11px] text-white/45">{team.record}</span>
                      </span>
                      <input
                        inputMode="decimal"
                        aria-label={`${team.name} ${t('lsHub.ms.score')}`}
                        className={scoreInput}
                        value={draft[m.matchupId]?.[side] ?? ''}
                        onChange={(e) =>
                          setDraft((d) => ({ ...d, [m.matchupId]: { ...d[m.matchupId]!, [side]: clean(e.target.value) } }))
                        }
                      />
                    </div>
                  ) : (
                    <p key={side} className="text-[11px] text-white/40">{t('lsHub.ms.bye')}</p>
                  ),
                )}
                {m.editedByCommish ? <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-200/70">{t('lsHub.ms.edited')}</p> : null}
              </li>
            ))}
          </ul>
          {error ? <p className="text-[12px] text-amber-200/85" role="alert">{error}</p> : null}
          <button
            type="button"
            disabled={saving || changed.length === 0}
            onClick={() => void save()}
            className="w-full rounded-full bg-cyan-400 px-4 py-3 text-[13px] font-extrabold tracking-wide text-[#04131a] disabled:opacity-40"
            data-testid="commish-edit-scores-save"
          >
            {saving ? t('lsHub.saving') : t('lsHub.ms.save').replace('{{week}}', String(data.week ?? ''))}
          </button>
        </>
      )}
    </HubCard>
  )
}

type RosterPlayer = { id: string; name: string; position: string | null; team: string | null }
type RosterPick = { ref: string; season: number; round: number; originalTeam: string | null }
type RosterTeam = { rosterId: string; name: string; players: RosterPlayer[]; picks: RosterPick[] }
type RosterAction = 'add' | 'drop' | 'send' | 'receive' | 'switch' | 'sendPicks' | 'receivePicks'

const ROSTER_ACTIONS: Array<{ id: RosterAction; picks?: boolean }> = [
  { id: 'add' },
  { id: 'drop' },
  { id: 'send' },
  { id: 'receive' },
  { id: 'switch' },
  { id: 'sendPicks', picks: true },
  { id: 'receivePicks', picks: true },
]

function playerLabel(p: RosterPlayer) {
  return [p.name, [p.position, p.team].filter(Boolean).join(' - ')].filter(Boolean).join('  ')
}

function CheckList<T>({
  items,
  selected,
  onToggle,
  keyOf,
  labelOf,
  empty,
}: {
  items: T[]
  selected: Set<string>
  onToggle: (key: string) => void
  keyOf: (item: T) => string
  labelOf: (item: T) => string
  empty: string
}) {
  if (items.length === 0) return <p className="text-[12px] text-white/45">{empty}</p>
  return (
    <ul className="max-h-64 divide-y divide-white/[0.06] overflow-y-auto rounded-xl border border-white/[0.08] bg-black/20">
      {items.map((item) => {
        const k = keyOf(item)
        return (
          <li key={k}>
            <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-[13px] text-white/85">
              <input type="checkbox" className="h-4 w-4 accent-cyan-400" checked={selected.has(k)} onChange={() => onToggle(k)} />
              <span className="truncate">{labelOf(item)}</span>
            </label>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * Edit Rosters: pick a team, then add free agents, drop players, or move players / future picks to
 * and from another team. Writes both roster stores server-side and is announced to the league.
 */
export function EditRostersCard({ leagueId }: { leagueId: string }) {
  const { t } = useLanguage()
  const [teams, setTeams] = useState<RosterTeam[] | null>(null)
  const [picksSupported, setPicksSupported] = useState(false)
  const [teamId, setTeamId] = useState<string | null>(null)
  const [action, setAction] = useState<RosterAction | null>(null)
  const [otherId, setOtherId] = useState('')
  const [mine, setMine] = useState<Set<string>>(new Set())
  const [theirs, setTheirs] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<RosterPlayer[]>([])
  const [picked, setPicked] = useState<Map<string, RosterPlayer>>(new Map())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const base = `/api/leagues/${encodeURIComponent(leagueId)}/commish-rosters`

  useEffect(() => {
    let cancelled = false
    fetch(base, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { teams: RosterTeam[]; picksSupported: boolean }) => {
        if (cancelled) return
        setTeams(d.teams)
        setPicksSupported(d.picksSupported)
      })
      .catch(() => !cancelled && setError(t('lsHub.ct.loadFailed')))
    return () => {
      cancelled = true
    }
  }, [base, t])

  useEffect(() => {
    if (action !== 'add' || query.trim().length < 2) {
      setResults([])
      return
    }
    const handle = window.setTimeout(() => {
      fetch(`/api/waiver-wire/leagues/${encodeURIComponent(leagueId)}/players?q=${encodeURIComponent(query.trim())}&limit=25`, {
        credentials: 'include',
      })
        .then((r) => (r.ok ? r.json() : { players: [] }))
        .then((d: { players?: RosterPlayer[] }) => setResults((d.players ?? []).slice(0, 25)))
        .catch(() => setResults([]))
    }, 300)
    return () => window.clearTimeout(handle)
  }, [action, query, leagueId])

  const team = teams?.find((x) => x.rosterId === teamId) ?? null
  const other = teams?.find((x) => x.rosterId === otherId) ?? null
  const reset = (next: RosterAction | null) => {
    setAction(next)
    setOtherId('')
    setMine(new Set())
    setTheirs(new Set())
    setQuery('')
    setResults([])
    setPicked(new Map())
    setError(null)
  }
  const toggle = (set: Set<string>, setter: (s: Set<string>) => void) => (k: string) => {
    const next = new Set(set)
    if (next.has(k)) next.delete(k)
    else next.add(k)
    setter(next)
  }

  const body = (): Record<string, unknown> | null => {
    if (!team || !action) return null
    if (action === 'add') return picked.size ? { action: 'add', rosterId: team.rosterId, players: [...picked.values()] } : null
    if (action === 'drop') return mine.size ? { action: 'drop', rosterId: team.rosterId, playerIds: [...mine] } : null
    if (!other) return null
    const moves: Array<Record<string, unknown>> = []
    if (action === 'send' && mine.size) moves.push({ fromRosterId: team.rosterId, toRosterId: other.rosterId, playerIds: [...mine] })
    if (action === 'receive' && theirs.size) moves.push({ fromRosterId: other.rosterId, toRosterId: team.rosterId, playerIds: [...theirs] })
    if (action === 'switch' && mine.size && theirs.size) {
      moves.push({ fromRosterId: team.rosterId, toRosterId: other.rosterId, playerIds: [...mine] })
      moves.push({ fromRosterId: other.rosterId, toRosterId: team.rosterId, playerIds: [...theirs] })
    }
    if (action === 'sendPicks' && mine.size) moves.push({ fromRosterId: team.rosterId, toRosterId: other.rosterId, pickRefs: [...mine] })
    if (action === 'receivePicks' && theirs.size) moves.push({ fromRosterId: other.rosterId, toRosterId: team.rosterId, pickRefs: [...theirs] })
    return moves.length ? { action: 'move', moves } : null
  }

  const submit = async () => {
    const payload = body()
    if (!payload) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(base, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : t('lsHub.sp.saveFailed'))
        return
      }
      setTeams(data.teams as RosterTeam[])
      toast.success(t('lsHub.er.done'))
      reset(null)
    } catch {
      setError(t('lsHub.sp.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  const pickLabel = (p: RosterPick) =>
    t('lsHub.er.pick').replace('{{season}}', String(p.season)).replace('{{round}}', String(p.round)) +
    (p.originalTeam ? ` (${p.originalTeam})` : '')
  const otherTeams = (teams ?? []).filter((x) => x.rosterId !== teamId)
  const needsOther = action != null && action !== 'add' && action !== 'drop'

  return (
    <HubCard title={t('lsHub.er.title')} testId="commish-edit-rosters">
      <p className="text-[12px] text-white/50">{t('lsHub.er.hint')}</p>
      {teams == null ? (
        error ? <p className="text-[12px] text-red-300/85">{error}</p> : <div className="h-24 animate-pulse rounded-xl bg-white/[0.05]" />
      ) : !team ? (
        <ul className="divide-y divide-white/[0.06] rounded-2xl border border-white/[0.08] bg-black/20" data-testid="commish-edit-rosters-teams">
          {teams.map((x) => (
            <li key={x.rosterId}>
              <button type="button" onClick={() => setTeamId(x.rosterId)} className="flex w-full items-center justify-between px-4 py-3 text-left text-[14px] font-semibold text-white hover:bg-white/[0.04]">
                <span className="truncate">{x.name}</span>
                <span className="text-[11px] font-normal text-white/40">{t('lsHub.er.count').replace('{{n}}', String(x.players.length))}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : !action ? (
        <div className="space-y-2">
          <button type="button" onClick={() => setTeamId(null)} className="text-[12px] font-semibold text-cyan-200/80">
            ← {team.name}
          </button>
          <ul className="divide-y divide-white/[0.06] rounded-2xl border border-white/[0.08] bg-black/20">
            {ROSTER_ACTIONS.filter((a) => !a.picks || picksSupported).map((a) => (
              <li key={a.id}>
                <button type="button" onClick={() => reset(a.id)} className="w-full px-4 py-3 text-left hover:bg-white/[0.04]" data-testid={`commish-roster-action-${a.id}`}>
                  <span className="block text-[14px] font-bold text-white">{t(`lsHub.er.a.${a.id}`)}</span>
                  <span className="block text-[12px] text-white/50">{t(`lsHub.er.a.${a.id}Hint`)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="space-y-3">
          <button type="button" onClick={() => reset(null)} className="text-[12px] font-semibold text-cyan-200/80">
            ← {team.name} · {t(`lsHub.er.a.${action}`)}
          </button>

          {needsOther ? (
            <select
              value={otherId}
              onChange={(e) => {
                setOtherId(e.target.value)
                setTheirs(new Set())
              }}
              className="w-full rounded-xl border border-white/[0.10] bg-black/25 px-3 py-2.5 text-sm text-white"
              data-testid="commish-roster-other-team"
            >
              <option value="" className="bg-[#0d1117]">{t('lsHub.er.chooseTeam')}</option>
              {otherTeams.map((x) => (
                <option key={x.rosterId} value={x.rosterId} className="bg-[#0d1117]">
                  {x.name}
                </option>
              ))}
            </select>
          ) : null}

          {action === 'add' ? (
            <>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('lsHub.er.search')}
                className="w-full rounded-xl border border-white/[0.10] bg-black/25 px-3 py-2.5 text-sm text-white placeholder:text-white/30"
                data-testid="commish-roster-search"
              />
              <CheckList
                items={results}
                selected={new Set(picked.keys())}
                onToggle={(k) => {
                  const next = new Map(picked)
                  const hit = results.find((r) => r.id === k)
                  if (next.has(k)) next.delete(k)
                  else if (hit) next.set(k, hit)
                  setPicked(next)
                }}
                keyOf={(p) => p.id}
                labelOf={playerLabel}
                empty={query.trim().length < 2 ? t('lsHub.er.typeToSearch') : t('lsHub.er.noResults')}
              />
              {picked.size ? <p className="text-[12px] text-white/60">{t('lsHub.er.selected').replace('{{list}}', [...picked.values()].map((p) => p.name).join(', '))}</p> : null}
            </>
          ) : null}

          {action === 'drop' || action === 'send' || action === 'switch' ? (
            <div className="space-y-1">
              {action === 'switch' ? <p className="text-[11px] font-bold uppercase tracking-wide text-white/40">{team.name}</p> : null}
              <CheckList items={team.players} selected={mine} onToggle={toggle(mine, setMine)} keyOf={(p) => p.id} labelOf={playerLabel} empty={t('lsHub.er.noPlayers')} />
            </div>
          ) : null}

          {(action === 'receive' || action === 'switch') && other ? (
            <div className="space-y-1">
              {action === 'switch' ? <p className="text-[11px] font-bold uppercase tracking-wide text-white/40">{other.name}</p> : null}
              <CheckList items={other.players} selected={theirs} onToggle={toggle(theirs, setTheirs)} keyOf={(p) => p.id} labelOf={playerLabel} empty={t('lsHub.er.noPlayers')} />
            </div>
          ) : null}

          {action === 'sendPicks' ? (
            <CheckList items={team.picks} selected={mine} onToggle={toggle(mine, setMine)} keyOf={(p) => p.ref} labelOf={pickLabel} empty={t('lsHub.er.noPicks')} />
          ) : null}
          {action === 'receivePicks' && other ? (
            <CheckList items={other.picks} selected={theirs} onToggle={toggle(theirs, setTheirs)} keyOf={(p) => p.ref} labelOf={pickLabel} empty={t('lsHub.er.noPicks')} />
          ) : null}

          {error ? <p className="text-[12px] text-amber-200/85" role="alert">{error}</p> : null}
          <button
            type="button"
            disabled={busy || !body()}
            onClick={() => void submit()}
            className="w-full rounded-full bg-cyan-400 px-4 py-3 text-[13px] font-extrabold text-[#04131a] disabled:opacity-40"
            data-testid="commish-roster-submit"
          >
            {busy ? t('lsHub.saving') : t('lsHub.er.confirm')}
          </button>
        </div>
      )}
    </HubCard>
  )
}

type BracketSide = { rosterId: string; name: string; seed: number | null } | null
type BracketData = {
  seasonStatus: string
  generated: boolean
  playoffTeamCount: number
  seedingSource: 'standings' | 'commissioner'
  reseedBlocked: string | null
  seeds: Array<{ seed: number; rosterId: string; name: string; record: string }>
  teams: Array<{ rosterId: string; name: string; record: string }>
  rounds: Array<{
    roundNumber: number
    roundName: string
    status: string
    matchups: Array<{
      matchupId: string
      home: BracketSide
      away: BracketSide
      homeScore: number | null
      awayScore: number | null
      winnerRosterId: string | null
      bye: boolean
      commishPick: boolean
    }>
  }>
}

/**
 * Edit Playoff Bracket: reseed (who is in, in what order) until round one is decided, and pick a
 * matchup winner in a round still being played. The server owns every rule; this only shows them.
 */
export function EditPlayoffBracketCard({ leagueId }: { leagueId: string }) {
  const { t } = useLanguage()
  const [data, setData] = useState<BracketData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [order, setOrder] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const url = `/api/leagues/${encodeURIComponent(leagueId)}/commish-playoffs`

  const apply = useCallback((d: BracketData) => {
    setData(d)
    setOrder(d.seeds.map((s) => s.rosterId))
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch(url, { credentials: 'include' })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}))
        if (cancelled) return
        if (r.ok) apply(body as BracketData)
        else setLoadError(typeof body.error === 'string' ? body.error : t('lsHub.ct.loadFailed'))
      })
      .catch(() => !cancelled && setLoadError(t('lsHub.ct.loadFailed')))
    return () => {
      cancelled = true
    }
  }, [url, t, apply])

  const send = async (payload: Record<string, unknown>, done: string) => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof body.error === 'string' ? body.error : t('lsHub.sp.saveFailed'))
        return
      }
      apply(body as BracketData)
      toast.success(done)
    } catch {
      setError(t('lsHub.sp.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  const canReseed = data != null && data.generated && data.reseedBlocked == null
  const changed = data != null && order.some((id, i) => id !== data.seeds[i]?.rosterId)
  const duplicate = new Set(order).size !== order.length
  const teamName = (id: string) => data?.teams.find((x) => x.rosterId === id)?.name ?? id

  const pickWinner = (matchupId: string, team: NonNullable<BracketSide>) => {
    if (!window.confirm(t('lsHub.pb.confirmWinner').replace('{{team}}', team.name))) return
    void send({ action: 'set_winner', matchupId, winnerRosterId: team.rosterId }, t('lsHub.pb.winnerSaved'))
  }

  return (
    <HubCard title={t('lsHub.pb.title')} testId="commish-edit-playoffs">
      <p className="text-[12px] text-white/50">{t('lsHub.pb.hint')}</p>
      {loadError ? (
        <p className="text-[12px] text-white/50">{loadError}</p>
      ) : !data ? (
        <div className="h-24 animate-pulse rounded-xl bg-white/[0.05]" />
      ) : (
        <>
          {!data.generated ? <p className="text-[12px] text-amber-200/80">{t('lsHub.pb.notGenerated')}</p> : null}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-bold uppercase tracking-wide text-white/40">{t('lsHub.pb.seeds')}</p>
              <span className="text-[11px] text-white/45">
                {data.seedingSource === 'commissioner' ? t('lsHub.pb.commishSeeds') : t('lsHub.pb.standingsSeeds')}
              </span>
            </div>
            <ul className="divide-y divide-white/[0.06] rounded-2xl border border-white/[0.08] bg-black/20" data-testid="commish-playoff-seeds">
              {(canReseed ? order : data.seeds.map((s) => s.rosterId)).map((rosterId, i) => (
                <li key={i} className="flex items-center gap-3 px-3 py-2">
                  <span className="w-12 shrink-0 text-[12px] font-bold text-cyan-200/80">{t('lsHub.pb.seedN').replace('{{n}}', String(i + 1))}</span>
                  {canReseed ? (
                    <select
                      value={rosterId}
                      onChange={(e) => setOrder((o) => o.map((x, j) => (j === i ? e.target.value : x)))}
                      aria-label={t('lsHub.pb.seedN').replace('{{n}}', String(i + 1))}
                      className="min-w-0 flex-1 rounded-xl border border-white/[0.10] bg-black/25 px-3 py-2 text-[13px] text-white"
                    >
                      {data.teams.map((x) => (
                        <option key={x.rosterId} value={x.rosterId} className="bg-[#0d1117]">
                          {x.name} ({x.record})
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="truncate text-[13px] font-semibold text-white">{teamName(rosterId)}</span>
                  )}
                </li>
              ))}
            </ul>
            {data.generated && data.reseedBlocked ? <p className="text-[12px] text-white/45">{t('lsHub.pb.seedsLocked')}</p> : null}
            {canReseed && duplicate ? <p className="text-[12px] text-amber-200/85">{t('lsHub.pb.duplicate')}</p> : null}
            {canReseed ? (
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy || !changed || duplicate}
                  onClick={() => void send({ action: 'reseed', seeds: order }, t('lsHub.pb.seedsSaved'))}
                  className="flex-1 rounded-full bg-cyan-400 px-4 py-3 text-[13px] font-extrabold text-[#04131a] disabled:opacity-40"
                  data-testid="commish-playoff-save-seeds"
                >
                  {busy ? t('lsHub.saving') : t('lsHub.pb.saveSeeds')}
                </button>
                {data.seedingSource === 'commissioner' ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void send({ action: 'reset_seeds' }, t('lsHub.pb.seedsSaved'))}
                    className="rounded-full border border-white/[0.14] px-4 py-3 text-[13px] font-bold text-white/80 disabled:opacity-40"
                  >
                    {t('lsHub.pb.resetSeeds')}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>

          {data.rounds.length ? (
            <div className="space-y-3">
              <p className="text-[12px] text-white/50">{t('lsHub.pb.pickWinner')}</p>
              {data.rounds.map((r) => (
                <div key={r.roundNumber} className="space-y-1.5">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-white/40">{r.roundName}</p>
                  <ul className="divide-y divide-white/[0.06] rounded-2xl border border-white/[0.08] bg-black/20">
                    {r.matchups.map((m) => {
                      const open = r.status !== 'completed' && data.seasonStatus !== 'complete' && !m.bye && m.home && m.away
                      return (
                        <li key={m.matchupId} className="space-y-1 px-3 py-2">
                          {[
                            { team: m.home, score: m.homeScore },
                            { team: m.away, score: m.awayScore },
                          ].map(({ team, score }, i) =>
                            team ? (
                              <button
                                key={i}
                                type="button"
                                disabled={!open || busy}
                                onClick={() => pickWinner(m.matchupId, team)}
                                className={`flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left text-[13px] disabled:cursor-default ${
                                  m.winnerRosterId === team.rosterId ? 'bg-cyan-400/15 font-bold text-cyan-100' : 'text-white/85'
                                }`}
                              >
                                <span className="truncate">
                                  {team.seed ? <span className="mr-1.5 text-white/40">{team.seed}</span> : null}
                                  {team.name}
                                </span>
                                <span className="shrink-0 tabular-nums text-white/60">{score ?? ''}</span>
                              </button>
                            ) : (
                              <p key={i} className="px-2 py-1.5 text-[12px] text-white/40">
                                {m.bye ? t('lsHub.pb.bye') : t('lsHub.pb.tbd')}
                              </p>
                            ),
                          )}
                          {m.commishPick ? <p className="px-2 text-[11px] font-semibold uppercase tracking-wide text-amber-200/70">{t('lsHub.pb.commishPick')}</p> : null}
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
            </div>
          ) : null}
          {error ? <p className="text-[12px] text-amber-200/85" role="alert">{error}</p> : null}
        </>
      )}
    </HubCard>
  )
}

type LineupSection = 'bench' | 'ir' | 'taxi' | 'devy'
type LineupData = {
  rosterId: string
  week: number
  /** This-week view: completed weeks the commish may still change. */
  pastWeeks?: number[]
  /** Past-week view only. */
  weeks?: number[]
  savedForWeek?: boolean
  scoreEdited?: boolean
  matchup?: { myScore: number; theirScore: number | null } | null
  slots: Array<{ label: string; allowedPositions: string[] }>
  limits: Record<'starters' | LineupSection, number>
  players: Array<{ id: string; name: string; position: string | null; team: string | null }>
  lineup: { starters: string[] } & Record<LineupSection, string[]>
}
const LINEUP_SECTIONS: LineupSection[] = ['bench', 'ir', 'taxi', 'devy']

/**
 * Edit Lineup: set any team's starters slot by slot, and bench / IR / taxi / devy — for the current week,
 * or for a completed week, which re-scores that matchup and the standings. Commish edits skip kickoff
 * locks; the server checks slot eligibility and section limits again.
 */
export function EditLineupCard({ leagueId }: { leagueId: string }) {
  const { t } = useLanguage()
  const [teams, setTeams] = useState<Array<{ rosterId: string; name: string }> | null>(null)
  const [teamId, setTeamId] = useState<string | null>(null)
  const [data, setData] = useState<LineupData | null>(null)
  const [draft, setDraft] = useState<LineupData['lineup'] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** null = this week; a number = that completed week. */
  const [viewWeek, setViewWeek] = useState<number | null>(null)
  const [pastWeeks, setPastWeeks] = useState<number[]>([])
  const base = `/api/leagues/${encodeURIComponent(leagueId)}/commish-lineup`

  useEffect(() => {
    let cancelled = false
    fetch(base, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { teams: Array<{ rosterId: string; name: string }> }) => !cancelled && setTeams(d.teams))
      .catch(() => !cancelled && setError(t('lsHub.ct.loadFailed')))
    return () => {
      cancelled = true
    }
  }, [base, t])

  const apply = (d: LineupData) => {
    setData(d)
    setDraft({ ...d.lineup, starters: [...d.lineup.starters] })
    if (d.pastWeeks) setPastWeeks(d.pastWeeks)
    else if (d.weeks) setPastWeeks(d.weeks)
  }

  const open = async (rosterId: string, week: number | null = null) => {
    setTeamId(rosterId)
    setViewWeek(week)
    setData(null)
    setDraft(null)
    setError(null)
    try {
      const qs = `rosterId=${encodeURIComponent(rosterId)}${week != null ? `&week=${week}` : ''}`
      const res = await fetch(`${base}?${qs}`, { credentials: 'include' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof body.error === 'string' ? body.error : t('lsHub.ct.loadFailed'))
        return
      }
      apply(body as LineupData)
    } catch {
      setError(t('lsHub.ct.loadFailed'))
    }
  }

  const player = (id: string) => data?.players.find((p) => p.id === id)
  const label = (id: string) => {
    const p = player(id)
    return p ? [p.name, [p.position, p.team].filter(Boolean).join(' - ')].filter(Boolean).join('  ') : id
  }

  /** Put a player into a starting slot. Whoever held the slot goes to the bench; a starter moved from
   * another slot swaps with them instead, so nobody drops off the lineup by accident. */
  const setStarter = (slot: number, id: string) => {
    if (!draft) return
    const next = { ...draft, starters: [...draft.starters] }
    const prev = next.starters[slot] ?? ''
    for (const k of LINEUP_SECTIONS) next[k] = next[k].filter((x) => x !== id)
    const from = id ? next.starters.indexOf(id) : -1
    next.starters[slot] = id
    if (from >= 0 && from !== slot) next.starters[from] = prev
    else if (prev && prev !== id) next.bench = [...next.bench, prev]
    setDraft(next)
  }

  /** Move a non-starter between bench, IR, taxi and devy. */
  const setSection = (id: string, to: LineupSection) => {
    if (!draft) return
    const next = { ...draft }
    for (const k of LINEUP_SECTIONS) next[k] = next[k].filter((x) => x !== id)
    next[to] = [...next[to], id]
    setDraft(next)
  }

  const changed = data != null && draft != null && JSON.stringify(draft) !== JSON.stringify(data.lineup)

  const save = async () => {
    if (!draft || !teamId) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(base, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rosterId: teamId, lineup: draft, ...(viewWeek != null ? { week: viewWeek } : {}) }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof body.error === 'string' ? body.error : t('lsHub.sp.saveFailed'))
        return
      }
      apply(body as LineupData)
      toast.success(viewWeek != null ? t('lsHub.el.pastSaved').replace('{{week}}', String(viewWeek)) : t('lsHub.el.saved'))
    } catch {
      setError(t('lsHub.sp.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  const team = teams?.find((x) => x.rosterId === teamId) ?? null
  const usableSections = data ? LINEUP_SECTIONS.filter((k) => k === 'bench' || data.limits[k] > 0 || (draft?.[k].length ?? 0) > 0) : []
  const selectCls = 'min-w-0 flex-1 rounded-xl border border-white/[0.10] bg-black/25 px-3 py-2 text-[13px] text-white'

  return (
    <HubCard title={t('lsHub.el.title')} testId="commish-edit-lineup">
      <p className="text-[12px] text-white/50">{t('lsHub.el.hint')}</p>
      {teams == null ? (
        error ? <p className="text-[12px] text-red-300/85">{error}</p> : <div className="h-24 animate-pulse rounded-xl bg-white/[0.05]" />
      ) : !team ? (
        <ul className="divide-y divide-white/[0.06] rounded-2xl border border-white/[0.08] bg-black/20" data-testid="commish-edit-lineup-teams">
          {teams.map((x) => (
            <li key={x.rosterId}>
              <button type="button" onClick={() => void open(x.rosterId)} className="w-full truncate px-4 py-3 text-left text-[14px] font-semibold text-white hover:bg-white/[0.04]">
                {x.name}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="space-y-3">
          <button type="button" onClick={() => setTeamId(null)} className="text-[12px] font-semibold text-cyan-200/80">
            ← {team.name}
            {data ? ` · ${t('lsHub.el.week').replace('{{week}}', String(data.week))}` : ''}
          </button>
          {pastWeeks.length > 0 ? (
            <div className="scrollbar-none flex gap-1.5 overflow-x-auto pb-1" role="radiogroup" aria-label={t('lsHub.el.chooseWeek')}>
              {[null, ...pastWeeks].map((w) => (
                <button
                  key={w ?? 'now'}
                  type="button"
                  role="radio"
                  aria-checked={viewWeek === w}
                  disabled={busy}
                  onClick={() => void open(team.rosterId, w)}
                  className={`shrink-0 rounded-full border px-3 py-1.5 text-[12px] font-semibold ${
                    viewWeek === w ? 'border-cyan-300 bg-cyan-400 text-[#04131a]' : 'border-white/[0.12] bg-white/[0.04] text-white/70'
                  }`}
                >
                  {w == null ? t('lsHub.el.thisWeek') : t('lsHub.el.week').replace('{{week}}', String(w))}
                </button>
              ))}
            </div>
          ) : null}
          {data && viewWeek != null ? (
            <div className="space-y-1">
              <p className="text-[12px] text-amber-200/80">{t('lsHub.el.pastHint')}</p>
              {data.matchup ? (
                <p className="text-[12px] text-white/60">
                  {t('lsHub.el.pastScore')
                    .replace('{{mine}}', data.matchup.myScore.toFixed(2))
                    .replace('{{theirs}}', data.matchup.theirScore != null ? data.matchup.theirScore.toFixed(2) : '—')}
                </p>
              ) : null}
              {data.savedForWeek === false ? <p className="text-[12px] text-white/45">{t('lsHub.el.pastUnsaved')}</p> : null}
              {data.scoreEdited ? <p className="text-[12px] text-amber-200/85" role="alert">{t('lsHub.el.pastScoreEdited')}</p> : null}
            </div>
          ) : null}
          {!data || !draft ? (
            error ? <p className="text-[12px] text-amber-200/85">{error}</p> : <div className="h-24 animate-pulse rounded-xl bg-white/[0.05]" />
          ) : (
            <>
              <p className="text-[11px] font-bold uppercase tracking-wide text-white/40">{t('lsHub.el.starters')}</p>
              <ul className="divide-y divide-white/[0.06] rounded-2xl border border-white/[0.08] bg-black/20" data-testid="commish-lineup-starters">
                {data.slots.map((slot, i) => (
                  <li key={i} className="flex items-center gap-3 px-3 py-2">
                    <span className="w-14 shrink-0 text-[12px] font-bold text-cyan-200/80">{slot.label}</span>
                    <select value={draft.starters[i] ?? ''} onChange={(e) => setStarter(i, e.target.value)} aria-label={slot.label} className={selectCls}>
                      <option value="" className="bg-[#0d1117]">{t('lsHub.el.empty')}</option>
                      {data.players
                        .filter((p) => fitsSlot(slot, p.position))
                        .map((p) => (
                          <option key={p.id} value={p.id} className="bg-[#0d1117]">
                            {label(p.id)}
                          </option>
                        ))}
                    </select>
                  </li>
                ))}
              </ul>
              <p className="text-[11px] font-bold uppercase tracking-wide text-white/40">{t('lsHub.el.reserves')}</p>
              {LINEUP_SECTIONS.flatMap((k) => draft[k]).length === 0 ? (
                <p className="text-[12px] text-white/45">{t('lsHub.el.noReserves')}</p>
              ) : (
                <ul className="divide-y divide-white/[0.06] rounded-2xl border border-white/[0.08] bg-black/20">
                  {LINEUP_SECTIONS.flatMap((k) => draft[k].map((id) => ({ id, k }))).map(({ id, k }) => (
                    <li key={id} className="flex items-center gap-3 px-3 py-2">
                      <span className="min-w-0 flex-1 truncate text-[13px] text-white/85">{label(id)}</span>
                      <select value={k} onChange={(e) => setSection(id, e.target.value as LineupSection)} aria-label={label(id)} className="w-28 shrink-0 rounded-xl border border-white/[0.10] bg-black/25 px-2 py-1.5 text-[12px] text-white">
                        {usableSections.map((s) => (
                          <option key={s} value={s} className="bg-[#0d1117]">
                            {t(`lsHub.el.s.${s}`)}
                          </option>
                        ))}
                      </select>
                    </li>
                  ))}
                </ul>
              )}
              {error ? <p className="text-[12px] text-amber-200/85" role="alert">{error}</p> : null}
              <button
                type="button"
                disabled={busy || !changed || Boolean(viewWeek != null && data.scoreEdited)}
                onClick={() => void save()}
                className="w-full rounded-full bg-cyan-400 px-4 py-3 text-[13px] font-extrabold text-[#04131a] disabled:opacity-40"
                data-testid="commish-lineup-save"
              >
                {busy ? t('lsHub.saving') : viewWeek != null ? t('lsHub.el.pastSave').replace('{{week}}', String(viewWeek)) : t('lsHub.el.save')}
              </button>
            </>
          )}
        </div>
      )}
    </HubCard>
  )
}
