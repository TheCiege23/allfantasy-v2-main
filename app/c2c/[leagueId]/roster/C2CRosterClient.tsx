'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAfSubGate } from '@/hooks/useAfSubGate'
import { DevyPlayerCard } from '@/app/devy/components/DevyPlayerCard'
import { C2CScoreSummaryBar } from '@/app/c2c/components/C2CScoreSummaryBar'
import { C2CCampusPlayerCard } from '@/app/c2c/components/C2CCampusPlayerCard'
import { C2CCantonPlayerCard } from '@/app/c2c/components/C2CCantonPlayerCard'
import { C2CPlayerModal } from '@/app/c2c/components/C2CPlayerModal'
import type { C2CPlayerRow } from '@/app/c2c/components/c2cPlayerTypes'
import { NBA_CBB_DEFAULTS, NFL_CFB_DEFAULTS } from '@/lib/c2c/sportDefaults'
import type { C2CConfigClient } from '@/lib/c2c/c2cUiLabels'
import type { RosterBalanceReport } from '@/lib/c2c/ai/c2cChimmy'

type RosterBuckets = {
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
  const [rosterId, setRosterId] = useState<string | null>(null)
  const [buckets, setBuckets] = useState<RosterBuckets | null>(null)
  const [seasonId, setSeasonId] = useState<string | null>(null)
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
      setSeasonId(season.id)
      setWeek(Math.max(1, season.currentWeek ?? 1))
      setSeasonYear(season.season)
      const roster = season.rosters?.find((r) => r.ownerId === userId)
      if (!roster?.id) throw new Error('No roster for user')
      setRosterId(roster.id)

      const rr = await fetch(
        `/api/c2c/roster?leagueId=${encodeURIComponent(leagueId)}&rosterId=${encodeURIComponent(roster.id)}`,
        { credentials: 'include' },
      )
      if (!rr.ok) throw new Error('Roster fetch failed')
      const rj = (await rr.json()) as { roster: RosterBuckets }
      setBuckets(rj.roster)

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
    : 'No scoring in devy — prospect rights only.'

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 text-center text-[13px] text-white/45" data-testid="c2c-roster-loading">
        Loading C2C roster…
      </div>
    )
  }
  if (err || !cfg || !buckets) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 text-center text-[13px] text-red-300/90" data-testid="c2c-roster-error">
        {err ?? 'Unable to load roster.'}
      </div>
    )
  }

  const showCampus = viewMode === 'full' || viewMode === 'campus'
  const showCanton = viewMode === 'full' || viewMode === 'canton'

  return (
    <div className="mx-auto max-w-3xl px-4 pb-12 pt-4">
      <div className="sticky top-14 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-white/[0.07] bg-[#0c0c1e]/95 p-1 backdrop-blur md:top-0">
        <div className="flex min-w-0 flex-1 gap-1">
          {(['full', 'campus', 'canton'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setViewMode(m)}
              className={`flex-1 rounded-lg px-2 py-2 text-[11px] font-bold uppercase tracking-wide ${
                viewMode === m ? 'bg-violet-600/30 text-white' : 'text-white/45 hover:bg-white/[0.04]'
              }`}
              data-testid={`c2c-view-${m}`}
            >
              {m === 'full' ? 'Full' : m === 'campus' ? 'Campus' : 'Canton'}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => void loadBalance()}
          disabled={!hasAfSub || balanceLoading}
          className="shrink-0 rounded-lg border border-cyan-500/35 bg-cyan-500/10 px-3 py-2 text-[11px] font-semibold text-cyan-100 hover:bg-cyan-500/15 disabled:cursor-not-allowed disabled:opacity-40"
          data-testid="c2c-roster-balance"
        >
          {balanceLoading ? '…' : 'Roster Balance'}
        </button>
      </div>

      {balanceOpen ? (
        <div
          className="mb-4 rounded-xl border border-white/[0.08] bg-[#0a1228]/90 p-4 text-[12px] text-white/80"
          data-testid="c2c-roster-balance-panel"
        >
          {balanceErr ? <p className="text-amber-200/90">{balanceErr}</p> : null}
          {balanceLoading ? <p className="text-white/55">Loading balance…</p> : null}
          {balanceReport ? (
            <div className="space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-wide text-white/45">Roster balance</p>
              <p>
                <span className="text-white/45">Campus side: </span>
                <span className="font-semibold text-violet-200">{balanceReport.campusSideGrade}</span>
                <span className="text-white/45"> · Canton side: </span>
                <span className="font-semibold text-blue-200">{balanceReport.cantonSideGrade}</span>
              </p>
              <p>
                <span className="text-white/45">Balance score: </span>
                {balanceReport.balanceScore}
                <span className="text-white/45"> · Weaker side: </span>
                {balanceReport.weakSide}
              </p>
              <p>
                <span className="text-white/45">Pipeline: </span>
                {balanceReport.pipelineHealth}
              </p>
              <ul className="list-disc space-y-1 pl-4 text-white/70">
                {balanceReport.recommendations.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          ) : !balanceErr && !balanceLoading ? (
            <p className="text-white/45">No report yet.</p>
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
          <div className="sticky top-28 z-[5] mb-3 rounded-lg border border-violet-500/30 bg-violet-950/40 px-3 py-2 md:top-12">
            <h2 className="text-[12px] font-bold uppercase tracking-wide text-violet-200">🎓 Campus starters</h2>
            <p className="text-[10px] text-violet-200/70">Points count toward team score</p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {slots.campus.map((slot, i) => {
              const p = buckets.campusStarters[i] ?? null
              return (
                <div key={slot.slot} className="rounded-xl border border-violet-500/20 bg-black/20 p-2">
                  <p className="text-[9px] font-bold uppercase text-violet-300/80">
                    {slot.position} · {slot.slot.replace(/^[^_]+_/, '')}
                  </p>
                  {p ? (
                    <C2CCampusPlayerCard
                      player={p}
                      onOpen={() => setModal({ open: true, player: p, side: 'campus' })}
                    />
                  ) : (
                    <div className="mt-2 rounded-lg border border-dashed border-white/[0.08] py-6 text-center text-[10px] text-white/35">
                      Empty
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      ) : null}

      {showCanton ? (
        <section className="mt-10" data-testid="c2c-canton-section">
          <div className="sticky top-28 z-[5] mb-3 rounded-lg border border-blue-500/30 bg-blue-950/40 px-3 py-2 md:top-12">
            <h2 className="text-[12px] font-bold uppercase tracking-wide text-blue-200">🏙 Canton starters</h2>
            <p className="text-[10px] text-blue-200/70">Points count toward team score</p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {slots.canton.map((slot, i) => {
              const p = buckets.cantonStarters[i] ?? null
              return (
                <div key={slot.slot} className="rounded-xl border border-blue-500/20 bg-black/20 p-2">
                  <p className="text-[9px] font-bold uppercase text-blue-300/80">
                    {slot.position} · {slot.slot.replace(/^[^_]+_/, '')}
                  </p>
                  {p ? (
                    <C2CCantonPlayerCard
                      player={p}
                      onOpen={() => setModal({ open: true, player: p, side: 'canton' })}
                    />
                  ) : (
                    <div className="mt-2 rounded-lg border border-dashed border-white/[0.08] py-6 text-center text-[10px] text-white/35">
                      Empty
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      ) : null}

      <section className="mt-10">
        <button
          type="button"
          onClick={() => setBenchBannerOpen((v) => !v)}
          className="flex w-full items-center justify-between rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-left text-[12px] font-semibold text-amber-100"
          data-testid="c2c-bench-banner"
        >
          <span>Bench — points display only, do not count</span>
          <span className="text-white/50">{benchBannerOpen ? '−' : '+'}</span>
        </button>
        {benchBannerOpen ? (
          <div className="mt-2 space-y-2">
            {buckets.bench.map((p) => (
              <div
                key={p.playerId}
                className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-black/20 p-2 opacity-90"
              >
                <span className="text-[9px] font-bold text-white/35">{p.playerSide === 'campus' ? '🎓' : '🏙'}</span>
                {p.playerSide === 'campus' ? (
                  <C2CCampusPlayerCard compact player={p} onOpen={() => setModal({ open: true, player: p, side: 'campus' })} />
                ) : (
                  <C2CCantonPlayerCard compact player={p} onOpen={() => setModal({ open: true, player: p, side: 'canton' })} />
                )}
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section className="mt-8 rounded-xl border border-amber-500/25 bg-[color:var(--c2c-panel)] p-3" data-testid="c2c-taxi-section">
        <h3 className="text-[11px] font-bold uppercase text-amber-200/90">Taxi — points do not count</h3>
        <div className="mt-2 space-y-2">
          {buckets.taxi.map((p) => (
            <DevyPlayerCard
              key={p.playerId}
              variant="taxi"
              playerId={p.playerId}
              name={p.playerName}
              position={p.position}
              subtitle={p.nflNbaTeam ?? p.school ?? undefined}
              schoolLogoUrl={p.schoolLogoUrl}
              classYear={p.classYear}
              onOpen={() => setModal({ open: true, player: p, side: p.playerSide === 'campus' ? 'campus' : 'canton' })}
            />
          ))}
          {buckets.taxi.length === 0 ? <p className="text-[11px] text-white/35">No taxi players</p> : null}
        </div>
      </section>

      <section className="mt-8 rounded-xl border border-violet-500/25 bg-violet-950/20 p-3" data-testid="c2c-devy-section">
        <h3 className="text-[11px] font-bold uppercase text-violet-200">Devy</h3>
        <p className="mt-1 text-[10px] text-violet-200/70">{campusDevyNote}</p>
        <div className="mt-2 space-y-2">
          {buckets.devy.map((p) => (
            <DevyPlayerCard
              key={p.playerId}
              variant="devy"
              playerId={p.playerId}
              name={p.playerName}
              position={p.position}
              schoolLogoUrl={p.schoolLogoUrl}
              classYear={p.classYear}
              onOpen={() => setModal({ open: true, player: p, side: 'campus' })}
            />
          ))}
          {buckets.devy.length === 0 ? <p className="text-[11px] text-white/35">No devy stash</p> : null}
        </div>
      </section>

      {buckets.ir.length > 0 ? (
        <section className="mt-6">
          <h3 className="text-[11px] font-bold uppercase text-white/45">IR</h3>
          <div className="mt-2 space-y-2 opacity-80">
            {buckets.ir.map((p) => (
              <p key={p.playerId} className="text-[12px] text-white/55">
                {p.playerName} · {p.position}
              </p>
            ))}
          </div>
        </section>
      ) : null}

      <p className="mt-8 text-center text-[10px] text-white/30">
        Week {week} · Season {seasonYear}
        {seasonId ? ` · ${seasonId.slice(0, 8)}…` : ''}
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
