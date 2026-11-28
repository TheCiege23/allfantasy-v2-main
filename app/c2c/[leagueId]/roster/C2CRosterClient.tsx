'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAfSubGate } from '@/hooks/useAfSubGate'
import { C2CScoreSummaryBar } from '@/app/c2c/components/C2CScoreSummaryBar'
import { C2CCampusPlayerCard } from '@/app/c2c/components/C2CCampusPlayerCard'
import { C2CCantonPlayerCard } from '@/app/c2c/components/C2CCantonPlayerCard'
import { C2CPlayerModal } from '@/app/c2c/components/C2CPlayerModal'
import type { C2CPlayerRow } from '@/app/c2c/components/c2cPlayerTypes'
import { NBA_CBB_DEFAULTS, NFL_CFB_DEFAULTS } from '@/lib/c2c/sportDefaults'
import type { C2CConfigClient } from '@/lib/c2c/c2cUiLabels'
import type { RosterBalanceReport } from '@/lib/c2c/ai/c2cChimmy'

export type RosterBuckets = {
  campusStarters: C2CPlayerRow[]
  cantonStarters: C2CPlayerRow[]
  bench: C2CPlayerRow[]
  taxi: C2CPlayerRow[]
  devy: C2CPlayerRow[]
  ir: C2CPlayerRow[]
}

export function C2CRosterClient({
  leagueId,
  userId,
  hasAfSub = false,
  initialViewMode = 'full',
}: {
  leagueId: string
  userId: string
  hasAfSub?: boolean
  initialViewMode?: 'full' | 'campus' | 'canton'
}) {
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [cfg, setCfg] = useState<C2CConfigClient | null>(null)
  const [, setRosterId] = useState<string | null>(null)
  const [buckets, setBuckets] = useState<RosterBuckets | null>(null)
  /** This week's stored points by playerId (only players with a scored row). */
  const [points, setPoints] = useState<Record<string, number>>({})
  const [week, setWeek] = useState(1)
  const [seasonYear, setSeasonYear] = useState(new Date().getFullYear())
  const [scores, setScores] = useState<{
    campus: number
    canton: number
    total: number
  } | null>(null)
  const [benchBannerOpen, setBenchBannerOpen] = useState(true)
  const [viewMode, setViewMode] = useState<'full' | 'campus' | 'canton'>(initialViewMode)
  const [modal, setModal] = useState<{ open: boolean; player: C2CPlayerRow | null; side: 'campus' | 'canton' }>({
    open: false,
    player: null,
    side: 'campus',
  })
  const [balanceOpen, setBalanceOpen] = useState(false)
  const [balanceLoading, setBalanceLoading] = useState(false)
  const [balanceReport, setBalanceReport] = useState<RosterBalanceReport | null>(null)
  const [balanceErr, setBalanceErr] = useState<string | null>(null)
  const { handleApiResponse } = useAfSubGate('commissioner_c2c_scouting')

  const loadBalance = useCallback(async () => {
    if (!hasAfSub) return
    setBalanceLoading(true)
    setBalanceErr(null)
    setBalanceReport(null)
    setBalanceOpen(true)
    try {
      const r = await fetch('/api/c2c/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'roster_balance', leagueId, managerId: userId }),
      })
      if (!(await handleApiResponse(r))) return
      const j = (await r.json().catch(() => ({}))) as { error?: string; report?: RosterBalanceReport }
      if (!r.ok) {
        setBalanceErr(typeof j.error === 'string' ? j.error : 'Roster balance failed')
        return
      }
      setBalanceReport(j.report ?? null)
    } finally {
      setBalanceLoading(false)
    }
  }, [handleApiResponse, hasAfSub, leagueId, userId])

  const slots = useMemo(() => {
    if (!cfg) return { campus: NFL_CFB_DEFAULTS.campusStarterSlots, canton: NFL_CFB_DEFAULTS.cantonStarterSlots }
    const nba = cfg.sportPair === 'NBA_CBB' || String(cfg.sportPair).includes('NBA')
    return nba
      ? { campus: NBA_CBB_DEFAULTS.campusStarterSlots, canton: NBA_CBB_DEFAULTS.cantonStarterSlots }
      : { campus: NFL_CFB_DEFAULTS.campusStarterSlots, canton: NFL_CFB_DEFAULTS.cantonStarterSlots }
  }, [cfg])

  const reload = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const cr = await fetch(`/api/c2c?leagueId=${encodeURIComponent(leagueId)}`, { credentials: 'include' })
      if (!cr.ok) throw new Error('C2C league not configured')
      const cj = (await cr.json()) as { c2c: C2CConfigClient }
      setCfg(cj.c2c)

      const sr = await fetch(`/api/redraft/season?leagueId=${encodeURIComponent(leagueId)}`, { credentials: 'include' })
      if (!sr.ok) throw new Error('No redraft season')
      const sj = (await sr.json()) as {
        season?: {
          id: string
          season: number
          currentWeek: number
          rosters?: { id: string; ownerId: string | null }[]
        }
      }
      const season = sj.season
      if (!season?.id) throw new Error('Season missing')
      setWeek(Math.max(1, season.currentWeek ?? 1))
      setSeasonYear(season.season)
      const roster = season.rosters?.find((r) => r.ownerId === userId)
      if (!roster?.id) throw new Error('No roster for user')
      setRosterId(roster.id)

      const rr = await fetch(
        `/api/c2c/roster?leagueId=${encodeURIComponent(leagueId)}&rosterId=${encodeURIComponent(roster.id)}&week=${Math.max(1, season.currentWeek ?? 1)}&season=${season.season}`,
        { credentials: 'include' },
      )
      if (!rr.ok) throw new Error('Roster fetch failed')
      const rj = (await rr.json()) as { roster: RosterBuckets; points?: Record<string, number> }
      setBuckets(rj.roster)
      setPoints(rj.points ?? {})

      const mu = await fetch(
        `/api/redraft/matchup?seasonId=${encodeURIComponent(season.id)}&week=${encodeURIComponent(String(Math.max(1, season.currentWeek ?? 1)))}`,
        { credentials: 'include' },
      )
      if (mu.ok) {
        const mj = (await mu.json()) as {
          matchups?: { id: string; homeRosterId: string; awayRosterId: string | null }[]
          c2cScores?: Record<string, { home: { officialTeamScore: number } | null; away: { officialTeamScore: number } | null }>
        }
        const matchup = mj.matchups?.find((m) => m.homeRosterId === roster.id || m.awayRosterId === roster.id)
        if (matchup && mj.c2cScores?.[matchup.id]) {
          const row =
            matchup.homeRosterId === roster.id ? mj.c2cScores[matchup.id].home : mj.c2cScores[matchup.id].away
          if (row) {
            const c2cRow = row as { officialTeamScore: number; campusStarterScore?: number; cantonStarterScore?: number }
            setScores({
              campus: c2cRow.campusStarterScore ?? 0,
              canton: c2cRow.cantonStarterScore ?? 0,
              total: c2cRow.officialTeamScore ?? 0,
            })
          }
        }
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [leagueId, userId])

  useEffect(() => {
    void reload()
  }, [reload])

  const campusDevyNote = cfg?.devyScoringEnabled
    ? 'Devy eligible for campus slots when moved to a campus starter.'
    : 'Prospect rights only — devy players do not score.'

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10 text-center text-[13px] text-[var(--muted)]" data-testid="c2c-roster-loading">
        Loading C2C roster…
      </div>
    )
  }
  if (err || !cfg || !buckets) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10 text-center text-[13px] text-[var(--bad)]" data-testid="c2c-roster-error">
        {err ?? 'Unable to load roster.'}
      </div>
    )
  }

  const showCampus = viewMode === 'full' || viewMode === 'campus'
  const showCanton = viewMode === 'full' || viewMode === 'canton'
  /** The Campus and Canton views list only that side's players (2026-11-23: Campus listed a Canton bench WR, the taxi and IR). */
  const sideMatches = (p: C2CPlayerRow) => viewMode === 'full' || p.playerSide === viewMode
  const bench = buckets.bench.filter(sideMatches)
  const taxi = buckets.taxi.filter(sideMatches)
  const devy = viewMode === 'canton' ? [] : buckets.devy
  const ir = buckets.ir.filter(sideMatches)
  const open = (p: C2CPlayerRow) => setModal({ open: true, player: p, side: p.playerSide === 'campus' ? 'campus' : 'canton' })
  const card = (p: C2CPlayerRow, showSide = false) =>
    p.playerSide === 'campus' ? (
      <C2CCampusPlayerCard key={p.playerId} player={p} pointsThisWeek={points[p.playerId] ?? null} showSide={showSide} onOpen={() => open(p)} />
    ) : (
      <C2CCantonPlayerCard key={p.playerId} player={p} pointsThisWeek={points[p.playerId] ?? null} showSide={showSide} onOpen={() => open(p)} />
    )
  /** "campus_RB1" → "RB1": the slot already names the position, so "RB · RB1" said it twice. */
  const slotLabel = (slot: string) => slot.replace(/^[^_]+_/, '')
  const starterGrid = 'grid grid-cols-1 gap-2 min-[520px]:grid-cols-2 lg:grid-cols-4'
  const empty = <div className="rounded-xl border border-dashed border-[var(--line2)] py-5 text-center text-[12px] text-[var(--muted)]">Empty</div>

  return (
    <div className="mx-auto max-w-6xl px-4 pb-12 pt-4">
      <div className="sticky top-14 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-1 backdrop-blur md:top-0">
        <div className="flex min-w-0 flex-1 gap-1">
          {(['full', 'campus', 'canton'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setViewMode(m)}
              aria-pressed={viewMode === m}
              className={`min-h-[40px] flex-1 rounded-lg px-2 text-[12px] font-bold ${
                viewMode === m ? 'bg-[var(--accent-soft)] text-[var(--text)]' : 'text-[var(--muted)] hover:bg-[var(--chip)]'
              }`}
              data-testid={`c2c-view-${m}`}
            >
              {m === 'full' ? 'Full roster' : m === 'campus' ? 'Campus' : 'Canton'}
            </button>
          ))}
        </div>
        {hasAfSub ? (
          <button
            type="button"
            onClick={() => void loadBalance()}
            disabled={balanceLoading}
            className="min-h-[40px] shrink-0 rounded-lg px-3 text-[12px] font-bold text-[var(--accent)] hover:bg-[var(--chip)] disabled:opacity-50"
            data-testid="c2c-roster-balance"
          >
            {balanceLoading ? 'Checking…' : 'Roster balance'}
          </button>
        ) : null}
      </div>

      {balanceOpen ? (
        <div className="mb-4 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 text-[13px] text-[var(--text2)]" data-testid="c2c-roster-balance-panel">
          {balanceErr ? <p className="text-[var(--c2c-amber)]">{balanceErr}</p> : null}
          {balanceLoading ? <p className="text-[var(--muted)]">Checking your balance…</p> : null}
          {balanceReport ? (
            <div className="space-y-2">
              <p className="text-[12px] font-bold text-[var(--muted)]">Roster balance</p>
              <p>
                <span className="text-[var(--muted)]">Campus side: </span>
                <span className="font-semibold text-[var(--campus)]">{balanceReport.campusSideGrade}</span>
                <span className="text-[var(--muted)]"> · Canton side: </span>
                <span className="font-semibold text-[var(--canton)]">{balanceReport.cantonSideGrade}</span>
              </p>
              <p>
                <span className="text-[var(--muted)]">Balance score: </span>
                {balanceReport.balanceScore}
                <span className="text-[var(--muted)]"> · Weaker side: </span>
                {balanceReport.weakSide}
              </p>
              <p>
                <span className="text-[var(--muted)]">Pipeline: </span>
                {balanceReport.pipelineHealth}
              </p>
              <ul className="list-disc space-y-1 pl-4">
                {balanceReport.recommendations.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          ) : !balanceErr && !balanceLoading ? (
            <p className="text-[var(--muted)]">No report yet.</p>
          ) : null}
        </div>
      ) : null}

      {/* No college weekly stats are ingested yet, so a stored campus 0 is absent
          data, not a score — it renders as a labeled absence, never as 0.0. */}
      <C2CScoreSummaryBar
        campus={scores && scores.campus > 0 ? scores.campus : null}
        canton={scores ? scores.canton : null}
        total={scores ? scores.total : null}
        config={cfg}
        compact
      />

      {showCampus ? (
        <section className="mt-8" data-testid="c2c-campus-section">
          <div className="mb-3 rounded-lg border border-[var(--campus-line)] bg-[var(--campus-soft)] px-3 py-2">
            <h2 className="text-[13px] font-bold text-[var(--campus)]">🎓 Campus starters</h2>
            <p className="text-[12px] text-[var(--text2)]">These count toward your score.</p>
          </div>
          <div className={starterGrid}>
            {slots.campus.map((slot, i) => {
              const p = buckets.campusStarters[i] ?? null
              return (
                <div key={slot.slot}>
                  <p className="mb-1 text-[11px] font-bold text-[var(--campus)]">{slotLabel(slot.slot)}</p>
                  {p ? card(p) : empty}
                </div>
              )
            })}
          </div>
        </section>
      ) : null}

      {showCanton ? (
        <section className="mt-10" data-testid="c2c-canton-section">
          <div className="mb-3 rounded-lg border border-[var(--canton-line)] bg-[var(--canton-soft)] px-3 py-2">
            <h2 className="text-[13px] font-bold text-[var(--canton)]">🏙 Canton starters</h2>
            <p className="text-[12px] text-[var(--text2)]">These count toward your score.</p>
          </div>
          <div className={starterGrid}>
            {slots.canton.map((slot, i) => {
              const p = buckets.cantonStarters[i] ?? null
              return (
                <div key={slot.slot}>
                  <p className="mb-1 text-[11px] font-bold text-[var(--canton)]">{slotLabel(slot.slot)}</p>
                  {p ? card(p) : empty}
                </div>
              )
            })}
          </div>
        </section>
      ) : null}

      {bench.length ? (
        <section className="mt-10">
          <button
            type="button"
            onClick={() => setBenchBannerOpen((v) => !v)}
            aria-expanded={benchBannerOpen}
            className="flex min-h-[44px] w-full items-center justify-between rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 text-left text-[13px] font-semibold text-[var(--text)]"
            data-testid="c2c-bench-banner"
          >
            <span>Bench <span className="font-normal text-[var(--muted)]">· points don’t count</span></span>
            <span className="text-[var(--muted)]">{benchBannerOpen ? '−' : '+'}</span>
          </button>
          {benchBannerOpen ? <div className={`mt-2 ${starterGrid}`}>{bench.map((p) => card(p, viewMode === 'full'))}</div> : null}
        </section>
      ) : null}

      {taxi.length ? (
        <section className="mt-8" data-testid="c2c-taxi-section">
          <h3 className="mb-2 text-[13px] font-bold text-[var(--c2c-amber)]">Taxi squad <span className="font-normal text-[var(--muted)]">· points don’t count</span></h3>
          <div className={starterGrid}>{taxi.map((p) => card(p))}</div>
        </section>
      ) : null}

      {devy.length ? (
        <section className="mt-8" data-testid="c2c-devy-section">
          <h3 className="text-[13px] font-bold text-[var(--campus)]">Devy</h3>
          <p className="mb-2 text-[12px] text-[var(--muted)]">{campusDevyNote}</p>
          <div className={starterGrid}>{devy.map((p) => card(p))}</div>
        </section>
      ) : null}

      {ir.length ? (
        <section className="mt-8" data-testid="c2c-ir-section">
          <h3 className="mb-2 text-[13px] font-bold text-[var(--text)]">Injured reserve</h3>
          <div className={starterGrid}>{ir.map((p) => card(p))}</div>
        </section>
      ) : null}

      <p className="mt-8 text-center text-[12px] text-[var(--faint)]">
        Week {week} · {seasonYear} season
      </p>

      <C2CPlayerModal
        open={modal.open}
        onClose={() => setModal({ open: false, player: null, side: 'campus' })}
        player={modal.player}
        side={modal.side}
        leagueId={leagueId}
        userId={userId}
        hasAfSub={hasAfSub}
        countsTowardScore={
          modal.player
            ? modal.player.bucketState === 'campus_starter' || modal.player.bucketState === 'canton_starter'
            : false
        }
      />
    </div>
  )
}
