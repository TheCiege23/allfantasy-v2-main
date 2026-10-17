'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { TeamSummaryBar } from '@/app/devy/components/TeamSummaryBar'
import { DevyPlayerCard } from '@/app/devy/components/DevyPlayerCard'
import { DevyPlayerModal, type DevyPlayerModalPayload } from '@/app/devy/components/DevyPlayerModal'
import { invalidateIntelligence } from '@/lib/dashboard/intelligence-events'

type PlayerState = {
  playerId: string
  playerName: string
  position: string
  bucketState: string
  scoringEligibility: string
  playerType: string
  school?: string | null
  classYear?: string | null
  projectedDeclarationYear?: number | null
  isTaxiEligible?: boolean
  taxiYearsUsed?: number
}

type TaxiSlot = {
  playerId: string
  playerName: string
  position: string
  taxiYearsCurrent: number
  taxiYearStart: number
}

type DevySlot = {
  playerId: string
  playerName: string
  position: string
  school?: string | null
  schoolLogoUrl?: string | null
  classYear?: string | null
  projectedDeclarationYear?: number | null
  hasEnteredNFL?: boolean
  nflEntryYear?: number | null
}

type WeeklyEntry = {
  fantasyPts: number
  eligibility: string
  bucketState: string
}

export function DevyRosterClient({
  leagueId,
  userId,
  hasAfSub = false,
}: {
  leagueId: string
  userId: string
  hasAfSub?: boolean
}) {
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [config, setConfig] = useState<Record<string, unknown> | null>(null)
  const [rosterId, setRosterId] = useState<string | null>(null)
  const [playerStates, setPlayerStates] = useState<PlayerState[]>([])
  const [taxiSlots, setTaxiSlots] = useState<TaxiSlot[]>([])
  const [devySlots, setDevySlots] = useState<DevySlot[]>([])
  const [seasonSnap, setSeasonSnap] = useState<{
    seasonYear: number
    currentWeek: number
    totalWeeks: number
  } | null>(null)
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null)
  const [weeklyByPlayer, setWeeklyByPlayer] = useState<Record<string, WeeklyEntry>>({})
  const [scoreContext, setScoreContext] = useState<{ week: number; season: number } | null>(null)
  const [benchBannerDismissed, setBenchBannerDismissed] = useState(false)
  const [irOpen, setIrOpen] = useState(false)
  const [taxiOpen, setTaxiOpen] = useState(false)
  const [devyOpen, setDevyOpen] = useState(false)
  const [modal, setModal] = useState<{ open: boolean; payload: DevyPlayerModalPayload | null }>({
    open: false,
    payload: null,
  })

  const reload = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const cr = await fetch(`/api/devy?leagueId=${encodeURIComponent(leagueId)}`, { credentials: 'include' })
      if (!cr.ok) throw new Error('Devy league not configured')
      const cj = (await cr.json()) as { config: Record<string, unknown> }
      setConfig(cj.config)

      const sr = await fetch(`/api/redraft/season?leagueId=${encodeURIComponent(leagueId)}`, {
        credentials: 'include',
      })
      if (!sr.ok) throw new Error('No redraft season for this league')
      const sj = (await sr.json()) as {
        season?: {
          rosters?: { id: string; ownerId: string | null }[]
          season: number
          currentWeek: number
          totalWeeks: number
        }
      }
      const season = sj.season
      if (!season) throw new Error('No redraft season')
      const rid =
        season.rosters?.find((r) => r.ownerId === userId)?.id ?? season.rosters?.[0]?.id ?? null
      if (!rid) throw new Error('No roster found')
      setRosterId(rid)

      const cw = Math.max(1, season.currentWeek || 1)
      const week = selectedWeek !== null ? selectedWeek : cw
      setSeasonSnap({
        seasonYear: season.season,
        currentWeek: cw,
        totalWeeks: season.totalWeeks ?? 18,
      })

      const qs = new URLSearchParams({
        leagueId,
        rosterId: rid,
        week: String(week),
        season: String(season.season),
      })
      const rr = await fetch(`/api/devy/roster?${qs.toString()}`, { credentials: 'include' })
      if (!rr.ok) throw new Error('Could not load devy roster')
      const rj = (await rr.json()) as {
        playerStates: PlayerState[]
        taxiSlots: TaxiSlot[]
        devySlots: DevySlot[]
        weeklyScores?: { week: number; season: number; byPlayerId: Record<string, WeeklyEntry> } | null
      }
      setPlayerStates(rj.playerStates ?? [])
      setTaxiSlots(rj.taxiSlots ?? [])
      setDevySlots(rj.devySlots ?? [])
      setWeeklyByPlayer(rj.weeklyScores?.byPlayerId ?? {})
      if (rj.weeklyScores) {
        setScoreContext({ week: rj.weeklyScores.week, season: rj.weeklyScores.season })
      } else {
        setScoreContext(null)
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [leagueId, userId, selectedWeek])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const h = window.location.hash.replace('#', '')
    if (h === 'taxi') setTaxiOpen(true)
    if (h === 'devy') {
      setDevyOpen(true)
      setTimeout(() => document.getElementById('devy-section')?.scrollIntoView({ behavior: 'smooth' }), 100)
    }
  }, [])

  const maxDevy = Number(config?.devySlots ?? 10)

  const starters = useMemo(
    () => playerStates.filter((s) => s.bucketState === 'active_starter'),
    [playerStates],
  )
  const bench = useMemo(
    () => playerStates.filter((s) => s.bucketState === 'active_bench'),
    [playerStates],
  )
  const ir = useMemo(() => playerStates.filter((s) => s.bucketState === 'ir'), [playerStates])
  const taxiStateIds = useMemo(() => new Set(playerStates.filter((s) => s.bucketState === 'taxi').map((s) => s.playerId)), [playerStates])

  const activeNflCount = useMemo(
    () => playerStates.filter((s) => ['active_starter', 'active_bench', 'ir'].includes(s.bucketState)).length,
    [playerStates],
  )

  const [pickCounts, setPickCounts] = useState({ rookie: 0, devy: 0 })

  useEffect(() => {
    if (!rosterId) return
    let cancelled = false
    fetch(
      `/api/devy/picks?leagueId=${encodeURIComponent(leagueId)}&rosterId=${encodeURIComponent(rosterId)}`,
      { credentials: 'include' },
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { inventory?: { years?: { year: number; rookiePicks: unknown[]; devyPicks: unknown[] }[] } }) => {
        if (cancelled || !d?.inventory?.years?.length) return
        const y = d.inventory.years[0]
        setPickCounts({ rookie: y.rookiePicks?.length ?? 0, devy: y.devyPicks?.length ?? 0 })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [leagueId, rosterId])

  async function patchRoster(body: Record<string, unknown>) {
    if (!rosterId) return
    const res = await fetch('/api/devy/roster', {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leagueId, rosterId, ...body }),
    })
    await reload()
    // Phase 3B.4: notify intelligence rail only on successful mutation.
    if (res.ok) {
      invalidateIntelligence({ leagueId, reason: 'roster_change' })
    }
  }

  const formatPts = (playerId: string) => {
    const row = weeklyByPlayer[playerId]
    if (!row || !scoreContext) return '—'
    if (row.eligibility === 'none') return '—'
    return row.fantasyPts.toFixed(1)
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-[13px] text-white/45">
        Loading roster…
      </div>
    )
  }

  if (err) {
    return (
      <div className="px-4 py-10 text-center text-[13px] text-red-300">
        {err}
        <div className="mt-4">
          <Link href={`/league/${leagueId}`} className="text-cyan-300 underline">
            Back to league
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#040915] text-white">
      <TeamSummaryBar
        leagueId={leagueId}
        rosterId={rosterId}
        hasAfSub={hasAfSub}
        activeCount={activeNflCount}
        taxiCount={taxiSlots.length}
        devyCount={devySlots.length}
        rookiePickCount={pickCounts.rookie}
        devyPickCount={pickCounts.devy}
        maxDevySlots={maxDevy}
      />

      {seasonSnap && scoreContext ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] bg-[#080c14] px-4 py-2">
          <p className="text-[11px] text-white/50">
            Fantasy points · Week {scoreContext.week} · {scoreContext.season} season
            <span className="ml-2 text-white/35">(player_weekly_scores)</span>
          </p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="min-h-[44px] rounded-lg border border-white/[0.1] px-3 py-1 text-[12px] text-white/80 md:min-h-0"
              onClick={() => setSelectedWeek(scoreContext.week - 1)}
              disabled={scoreContext.week <= 1}
              data-testid="devy-week-prev"
            >
              ←
            </button>
            <span className="min-w-[2rem] text-center text-[12px] font-mono text-cyan-200/90">
              {scoreContext.week}
            </span>
            <button
              type="button"
              className="min-h-[44px] rounded-lg border border-white/[0.1] px-3 py-1 text-[12px] text-white/80 md:min-h-0"
              onClick={() => setSelectedWeek(scoreContext.week + 1)}
              disabled={scoreContext.week >= seasonSnap.totalWeeks}
              data-testid="devy-week-next"
            >
              →
            </button>
            <button
              type="button"
              className="ml-2 text-[11px] text-cyan-400/80 underline"
              onClick={() => setSelectedWeek(null)}
              data-testid="devy-week-reset"
            >
              Current
            </button>
          </div>
        </div>
      ) : null}

      <div className="mx-auto max-w-3xl space-y-4 px-3 py-4 pb-24">
        <SectionTitle
          accent="var(--devy-active)"
          title="⚡ Starters"
          subtitle="Points count toward team score where eligible."
        />
        <div className="space-y-2">
          {starters.map((s) => (
            <DevyPlayerCard
              key={s.playerId}
              variant="starter"
              playerId={s.playerId}
              name={s.playerName}
              position={s.position}
              statusLabel="STARTER"
              pointsDisplay={formatPts(s.playerId)}
              onMove={(a) => {
                if (a === 'bench') void patchRoster({ playerId: s.playerId, action: 'move_to_bench' })
                if (a === 'ir') void patchRoster({ playerId: s.playerId, action: 'move_to_ir' })
                if (a === 'taxi') void patchRoster({ playerId: s.playerId, action: 'move_to_taxi' })
              }}
              onOpen={() =>
                setModal({
                  open: true,
                  payload: {
                    kind: 'nfl',
                    name: s.playerName,
                    position: s.position,
                    bucketLabel: 'Starter',
                    scoringLabel: s.scoringEligibility,
                    taxiEligible: s.isTaxiEligible,
                  },
                })
              }
            />
          ))}
        </div>

        <SectionTitle accent="white" title="🏈 Bench" subtitle="Display only for scoring" />
        {!benchBannerDismissed ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100">
            📊 Points shown — do not count
            <button
              type="button"
              className="ml-2 text-white/60 underline"
              onClick={() => setBenchBannerDismissed(true)}
            >
              Dismiss
            </button>
          </div>
        ) : null}
        <div className="space-y-2 opacity-90">
          {bench.map((s) => (
            <DevyPlayerCard
              key={s.playerId}
              variant="bench"
              playerId={s.playerId}
              name={s.playerName}
              position={s.position}
              statusLabel="BENCH"
              pointsDisplay={formatPts(s.playerId)}
              onMove={(a) => {
                if (a === 'ir') void patchRoster({ playerId: s.playerId, action: 'move_to_ir' })
                if (a === 'taxi') void patchRoster({ playerId: s.playerId, action: 'move_to_taxi' })
              }}
              onOpen={() =>
                setModal({
                  open: true,
                  payload: {
                    kind: 'nfl',
                    name: s.playerName,
                    position: s.position,
                    bucketLabel: 'Bench',
                    scoringLabel: s.scoringEligibility,
                    taxiEligible: s.isTaxiEligible,
                  },
                })
              }
            />
          ))}
        </div>

        <div className="sticky top-0 z-10 rounded-xl border border-white/[0.06] bg-[#0a1228]/95 backdrop-blur">
          <button
            type="button"
            className="flex w-full items-center justify-between px-3 py-2 text-left text-[13px] font-bold text-white/75"
            onClick={() => setIrOpen((v) => !v)}
          >
            🩺 IR
            <span className="text-white/40">{irOpen ? '▾' : '▸'}</span>
          </button>
          {irOpen ? (
            <div className="space-y-2 border-t border-white/[0.06] px-3 py-3">
              <p className="text-[11px] text-white/45">Injured reserve — points do not count.</p>
              {ir.map((s) => (
                <DevyPlayerCard
                  key={s.playerId}
                  variant="ir"
                  playerId={s.playerId}
                  name={s.playerName}
                  position={s.position}
                  statusLabel="IR"
                  pointsDisplay={formatPts(s.playerId)}
                  onMove={(a) => {
                    if (a === 'bench') void patchRoster({ playerId: s.playerId, action: 'move_to_bench' })
                  }}
                  onOpen={() =>
                    setModal({
                      open: true,
                      payload: {
                        kind: 'nfl',
                        name: s.playerName,
                        position: s.position,
                        bucketLabel: 'IR',
                        scoringLabel: s.scoringEligibility,
                      },
                    })
                  }
                />
              ))}
            </div>
          ) : null}
        </div>

        <div id="taxi-section" className="sticky top-0 z-10 rounded-xl border border-amber-500/20 bg-[color:var(--devy-badge-taxi)]">
          <button
            type="button"
            className="flex w-full items-center justify-between px-3 py-2 text-left text-[13px] font-bold text-amber-100"
            onClick={() => setTaxiOpen((v) => !v)}
          >
            🚕 Taxi
            <span className="text-amber-200/60">{taxiOpen ? '▾' : '▸'}</span>
          </button>
          {taxiOpen ? (
            <div className="space-y-2 border-t border-amber-500/20 px-3 py-3">
              <div className="rounded-lg border border-amber-500/25 bg-black/20 px-3 py-2 text-[11px] text-amber-100/90">
                📊 Taxi points do not count toward team score.
              </div>
              {taxiSlots.map((t) => (
                <DevyPlayerCard
                  key={t.playerId}
                  variant="taxi"
                  playerId={t.playerId}
                  name={t.playerName}
                  position={t.position}
                  taxiYear={{ current: t.taxiYearsCurrent, max: 4 }}
                  pointsDisplay={formatPts(t.playerId)}
                  onPromote={() =>
                    void patchRoster({ playerId: t.playerId, action: 'promote_to_active', targetSlot: 'active_bench' })
                  }
                  onOpen={() =>
                    setModal({
                      open: true,
                      payload: {
                        kind: 'nfl',
                        name: t.playerName,
                        position: t.position,
                        bucketLabel: 'Taxi',
                        scoringLabel: 'display_only',
                        taxiEligible: true,
                      },
                    })
                  }
                />
              ))}
              {playerStates
                .filter((s) => s.bucketState === 'taxi' && !taxiSlots.some((x) => x.playerId === s.playerId))
                .map((s) => (
                  <DevyPlayerCard
                    key={s.playerId}
                    variant="taxi"
                    playerId={s.playerId}
                    name={s.playerName}
                    position={s.position}
                    taxiYear={{ current: s.taxiYearsUsed ?? 1, max: 4 }}
                    pointsDisplay={formatPts(s.playerId)}
                    onPromote={() =>
                      void patchRoster({ playerId: s.playerId, action: 'promote_to_active', targetSlot: 'active_bench' })
                    }
                    onOpen={() =>
                      setModal({
                        open: true,
                        payload: { kind: 'nfl', name: s.playerName, position: s.position, bucketLabel: 'Taxi' },
                      })
                    }
                  />
                ))}
            </div>
          ) : (
            <p className="px-3 pb-3 text-[11px] text-amber-100/70">Show taxi ({taxiSlots.length + taxiStateIds.size})</p>
          )}
        </div>

        <div
          id="devy-section"
          className="sticky top-0 z-10 rounded-xl border border-violet-500/25 bg-[color:var(--devy-badge-devy)]"
        >
          <button
            type="button"
            className="flex w-full items-center justify-between px-3 py-2 text-left text-[13px] font-bold text-violet-100"
            onClick={() => setDevyOpen((v) => !v)}
          >
            🎓 Devy prospects
            <span className="text-violet-200/60">{devyOpen ? '▾' : '▸'}</span>
          </button>
          {devyOpen ? (
            <div className="space-y-2 border-t border-violet-500/20 px-3 py-3">
              <div className="rounded-lg border border-violet-500/25 bg-black/20 px-3 py-2 text-[11px] text-violet-100/90">
                College players — no fantasy scoring while devy.
              </div>
              {devySlots.map((d) => (
                <DevyPlayerCard
                  key={d.playerId}
                  variant="devy"
                  playerId={d.playerId}
                  name={d.playerName}
                  position={d.position}
                  subtitle={d.school ?? undefined}
                  schoolLogoUrl={d.schoolLogoUrl}
                  classYear={d.classYear ?? undefined}
                  projectedYear={d.projectedDeclarationYear ?? undefined}
                  onOpen={() =>
                    setModal({
                      open: true,
                      payload: {
                        kind: 'devy',
                        playerId: d.playerId,
                        name: d.playerName,
                        position: d.position,
                        school: d.school,
                        classYear: d.classYear,
                        projectedDeclaration: d.projectedDeclarationYear ? String(d.projectedDeclarationYear) : null,
                        hasEnteredNfl: d.hasEnteredNFL,
                        nflEntryYear: d.nflEntryYear ?? null,
                      },
                    })
                  }
                />
              ))}
            </div>
          ) : (
            <div className="px-3 pb-3">
              <button
                type="button"
                className="text-[12px] font-semibold text-violet-200 underline"
                onClick={() => setDevyOpen(true)}
              >
                Show devy ({devySlots.length})
              </button>
            </div>
          )}
        </div>
      </div>

      <DevyPlayerModal
        open={modal.open}
        onClose={() => setModal({ open: false, payload: null })}
        payload={modal.payload}
        leagueId={leagueId}
        hasAfSub={hasAfSub}
      />
    </div>
  )
}

function SectionTitle({ title, subtitle, accent }: { title: string; subtitle?: string; accent: string }) {
  return (
    <div className="border-b pb-1" style={{ borderColor: `${accent}44` }}>
      <h2 className="text-[14px] font-bold" style={{ color: accent === 'white' ? 'rgba(255,255,255,0.85)' : accent }}>
        {title}
      </h2>
      {subtitle ? <p className="text-[11px] text-white/40">{subtitle}</p> : null}
    </div>
  )
}
