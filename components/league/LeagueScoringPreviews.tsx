'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { BarChart3, Swords, Zap, Target, AlertTriangle, ChevronDown, ChevronUp, Loader2 } from 'lucide-react'
import { useLeagueRealtimeRefresh } from '@/hooks/useLeagueRealtimeRefresh'
import type { RosterScorePlayer } from '@/lib/types/liveScoring'
import { deriveMatchupHighlights } from '@/lib/live-scoring/matchupHighlights'

type StandingsPreview = { teamName: string; wins: number; losses: number; pointsFor: number; rank: number | null }
type MatchPreview = {
  teamName: string
  totalPoints: number
  opponentName: string | null
  winLoss: string | null
  rosterId?: string | null
  opponentRosterId?: string | null
  // redraft-enriched fields
  homeScore?: number | null
  awayScore?: number | null
  homeTeamName?: string | null
  awayTeamName?: string | null
  homeRosterId?: string | null
  awayRosterId?: string | null
  homeRosterWins?: number | null
  homeRosterLosses?: number | null
  awayRosterWins?: number | null
  awayRosterLosses?: number | null
}

type BreakdownCache = Record<string, { players: RosterScorePlayer[]; loading: boolean }>

function slotLabel(slotType: string): string {
  const s = slotType.toUpperCase()
  if (s === 'FLEX') return 'FLEX'
  if (s === 'DEF' || s === 'ST') return 'DST'
  return s
}

function PlayerBreakdownPanel({
  leagueId,
  rosterId,
  week,
  season,
  cache,
  setCache,
}: {
  leagueId: string
  rosterId: string
  week: number
  season: number
  cache: BreakdownCache
  setCache: React.Dispatch<React.SetStateAction<BreakdownCache>>
}) {
  const fetched = useRef(false)

  useEffect(() => {
    if (fetched.current) return
    fetched.current = true
    setCache((prev) => ({ ...prev, [rosterId]: { players: [], loading: true } }))
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/scoring/roster-scores?rosterId=${encodeURIComponent(rosterId)}&week=${week}&season=${season}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { players?: RosterScorePlayer[] }) => {
        setCache((prev) => ({ ...prev, [rosterId]: { players: d.players ?? [], loading: false } }))
      })
      .catch(() => {
        setCache((prev) => ({ ...prev, [rosterId]: { players: [], loading: false } }))
      })
    // setCache is a stable React setter — omit from deps to prevent re-runs on cache state changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId, rosterId, week, season])

  const state = cache[rosterId]

  if (!state || state.loading) {
    return (
      <div className="flex items-center gap-2 px-2 py-2 text-[11px] text-white/40">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        Loading players...
      </div>
    )
  }

  if (state.players.length === 0) {
    return <p className="px-2 py-1.5 text-[11px] text-white/35">No player data available.</p>
  }

  return (
    <ul className="mt-1 space-y-0.5" data-testid={`player-breakdown-${rosterId}`}>
      {state.players.map((p, i) => (
        <li key={`${p.playerName}-${i}`} className="flex items-baseline gap-1.5 text-[11px]">
          <span className="w-[30px] shrink-0 text-[9px] font-bold uppercase text-white/30">{slotLabel(p.slotType)}</span>
          <span className={`truncate ${p.hasStats ? 'text-white/80' : 'text-white/35'}`}>{p.playerName}</span>
          <span className="shrink-0 text-[10px] text-white/40">{p.position}</span>
          <span className={`ml-auto shrink-0 font-semibold tabular-nums ${p.pts > 0 ? 'text-cyan-200/90' : 'text-white/30'}`}>
            {p.hasStats ? p.pts.toFixed(1) : '—'}
          </span>
          {p.isFinalized ? null : p.hasStats ? (
            <span className="text-[9px] text-amber-400/70">LIVE</span>
          ) : null}
        </li>
      ))}
    </ul>
  )
}
type SeedPreview = { seed: number | null; teamName: string; pointsFor: number }

export default function LeagueScoringPreviews({
  leagueId,
  season,
  week = 1,
}: {
  leagueId: string
  season: number
  week?: number
}) {
  const [standings, setStandings] = useState<StandingsPreview[]>([])
  const [matchups, setMatchups] = useState<MatchPreview[]>([])
  const [seeds, setSeeds] = useState<SeedPreview[]>([])
  const [loaded, setLoaded] = useState(false)
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [breakdownCache, setBreakdownCache] = useState<BreakdownCache>({})

  const loadData = useCallback(async () => {
    try {
      const [sRes, mRes, pRes] = await Promise.all([
        fetch(`/api/leagues/${leagueId}/scoring/standings?season=${season}`),
        fetch(`/api/leagues/${leagueId}/scoring/matchups?season=${season}&week=${week}`),
        fetch(`/api/leagues/${leagueId}/scoring/playoff-seeds?season=${season}`),
      ])
      const sJson = await sRes.json().catch(() => ({})) as { standings?: unknown[] }
      const mJson = await mRes.json().catch(() => ({})) as { matchups?: unknown[] }
      const pJson = await pRes.json().catch(() => ({})) as { seeds?: unknown[] }

      const st = Array.isArray(sJson.standings) ? sJson.standings : []
      setStandings(
        st.slice(0, 4).map(
          (r) => {
            const row = r as { teamName?: string; wins?: number; losses?: number; pointsFor?: number; rank?: number | null }
            return {
              teamName: String(row.teamName ?? ''),
              wins: Number(row.wins ?? 0),
              losses: Number(row.losses ?? 0),
              pointsFor: Number(row.pointsFor ?? 0),
              rank: row.rank ?? null,
            }
          },
        ),
      )

      const mx = Array.isArray(mJson.matchups) ? mJson.matchups : []
      setMatchups(
        mx.map(
          (r) => {
            const row = r as {
              teamName?: string
              totalPoints?: number
              opponentName?: string | null
              winLoss?: string | null
              rosterId?: string | null
              opponentRosterId?: string | null
              homeScore?: number | null
              awayScore?: number | null
              homeTeamName?: string | null
              awayTeamName?: string | null
              homeRosterId?: string | null
              awayRosterId?: string | null
              homeRosterWins?: number | null
              homeRosterLosses?: number | null
              awayRosterWins?: number | null
              awayRosterLosses?: number | null
            }
            return {
              teamName: String(row.teamName ?? ''),
              totalPoints: Number(row.totalPoints ?? 0),
              opponentName: typeof row.opponentName === 'string' ? row.opponentName : null,
              winLoss: typeof row.winLoss === 'string' ? row.winLoss : null,
              rosterId: row.rosterId ?? null,
              opponentRosterId: row.opponentRosterId ?? null,
              homeScore: row.homeScore ?? null,
              awayScore: row.awayScore ?? null,
              homeTeamName: row.homeTeamName ?? null,
              awayTeamName: row.awayTeamName ?? null,
              homeRosterId: row.homeRosterId ?? null,
              awayRosterId: row.awayRosterId ?? null,
              homeRosterWins: row.homeRosterWins ?? null,
              homeRosterLosses: row.homeRosterLosses ?? null,
              awayRosterWins: row.awayRosterWins ?? null,
              awayRosterLosses: row.awayRosterLosses ?? null,
            }
          },
        ),
      )

      const sd = Array.isArray(pJson.seeds) ? pJson.seeds : []
      setSeeds(
        sd.slice(0, 6).map(
          (r) => {
            const row = r as { seed?: number | null; teamName?: string; pointsFor?: number }
            return {
              seed: row.seed ?? null,
              teamName: String(row.teamName ?? ''),
              pointsFor: Number(row.pointsFor ?? 0),
            }
          },
        ),
      )
    } finally {
      setLoaded(true)
    }
  }, [leagueId, season, week])

  useEffect(() => {
    void loadData()
  }, [loadData])

  useLeagueRealtimeRefresh(leagueId, (env) => {
    const t = String(env.eventType ?? '')
    if (t.includes('score') || t.includes('matchup') || t.includes('standings') || t === 'player_changed' || t === 'league_changed') {
      void loadData()
    }
  })

  if (!loaded) {
    return (
      <div className="mb-4 h-24 animate-pulse rounded-2xl border border-[#1E2A42] bg-[#131929]/80" aria-hidden />
    )
  }

  const hasData = standings.length > 0 || matchups.length > 0 || seeds.length > 0

  // Deduplicate matchups to unique pairings (API returns two rows per matchup — one per side).
  // Each row has rosterId (this team) + opponentRosterId (other team), plus homeTeamName/awayTeamName.
  // The home-perspective row: teamName === homeTeamName, so rosterId is the home roster ID.
  const seenPairs = new Set<string>()
  const pairedMatchups: Array<{
    homeTeam: string; awayTeam: string | null
    homeScore: number; awayScore: number | null
    homeRosterId: string | null; awayRosterId: string | null
    status: string | null
  }> = []
  for (const m of matchups) {
    if (m.homeTeamName) {
      const key = [m.homeTeamName, m.awayTeamName ?? ''].sort().join('__')
      if (!seenPairs.has(key)) {
        seenPairs.add(key)
        // Determine which side this row is from to assign rosterIds correctly.
        const isHomePerspective = m.teamName === m.homeTeamName
        pairedMatchups.push({
          homeTeam: m.homeTeamName,
          awayTeam: m.awayTeamName ?? null,
          homeScore: m.homeScore ?? 0,
          awayScore: m.awayScore ?? null,
          homeRosterId: isHomePerspective ? (m.rosterId ?? null) : (m.opponentRosterId ?? null),
          awayRosterId: isHomePerspective ? (m.opponentRosterId ?? null) : (m.rosterId ?? null),
          status: null,
        })
      }
    }
  }
  // Fall back to unpaired rows if no pairing data
  const displayMatchups = pairedMatchups.length > 0 ? pairedMatchups : null

  const highlights = deriveMatchupHighlights(matchups)

  return (
    <section className="mb-6 space-y-3" data-testid="league-scoring-previews">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#8B9DB8]">Scoring & results</h3>
        <div className="flex gap-2">
          <Link
            href={`/league/${leagueId}/standings`}
            className="inline-flex items-center gap-1 rounded-full border border-[#1E2A42] bg-[#131929] px-3 py-1.5 text-[12px] font-semibold text-white hover:border-cyan-400/40"
          >
            <BarChart3 className="h-3.5 w-3.5 text-cyan-300" />
            Standings
          </Link>
          <Link
            href={`/league/${leagueId}/matchups`}
            className="inline-flex items-center gap-1 rounded-full border border-[#1E2A42] bg-[#131929] px-3 py-1.5 text-[12px] font-semibold text-white hover:border-cyan-400/40"
          >
            <Swords className="h-3.5 w-3.5 text-fuchsia-300" />
            Matchups
          </Link>
        </div>
      </div>

      {!hasData ? (
        <p className="rounded-xl border border-dashed border-white/10 bg-black/20 px-3 py-3 text-[13px] text-white/50">
          Weekly scoring will populate here after stats are processed (commissioner: run process-week).
        </p>
      ) : (
        <div className="space-y-3">
          {/* Live highlight badges */}
          {(highlights.topScorerName || highlights.closestMatchup || highlights.upsetAlert) && (
            <div className="flex flex-wrap gap-2">
              {highlights.topScorerName && highlights.topScorerPts != null && (
                <span
                  className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/25 bg-cyan-500/10 px-2.5 py-1 text-[11px] font-semibold text-cyan-200"
                  data-testid="live-top-scorer"
                >
                  <Zap className="h-3 w-3" aria-hidden />
                  Top scorer: {highlights.topScorerName} · {highlights.topScorerPts.toFixed(1)} pts
                </span>
              )}
              {highlights.closestMatchup && (
                <span
                  className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/25 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-200"
                  data-testid="live-closest-matchup"
                >
                  <Target className="h-3 w-3" aria-hidden />
                  Closest: {highlights.closestMatchup.homeTeam} vs {highlights.closestMatchup.awayTeam} · {highlights.closestMatchup.diff.toFixed(1)} apart
                </span>
              )}
              {highlights.upsetAlert && (
                <span
                  className="inline-flex items-center gap-1.5 rounded-full border border-rose-400/25 bg-rose-500/10 px-2.5 py-1 text-[11px] font-semibold text-rose-200"
                  data-testid="live-upset-alert"
                >
                  <AlertTriangle className="h-3 w-3" aria-hidden />
                  Upset: {highlights.upsetAlert.leaderTeam} leading {highlights.upsetAlert.trailingTeam}
                </span>
              )}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {seeds.length > 0 ? (
              <div className="rounded-xl border border-fuchsia-500/20 bg-[#131929] p-3 sm:col-span-2">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-fuchsia-200/80">
                  Playoff seed preview
                </p>
                <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-white/85">
                  {seeds.map((s) => (
                    <li key={`${s.seed}-${s.teamName}`}>
                      <span className="text-white/40">{s.seed}.</span> {s.teamName}{' '}
                      <span className="text-white/50">({s.pointsFor.toFixed(1)} PF)</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="rounded-xl border border-[#1E2A42] bg-[#131929] p-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#8B9DB8]">Standings snapshot</p>
              <ul className="space-y-1.5 text-[13px] text-white/90">
                {standings.map((s) => (
                  <li key={s.teamName} className="flex justify-between gap-2">
                    <span className="truncate">
                      <span className="mr-2 text-white/40">{s.rank ?? '—'}.</span>
                      {s.teamName}
                    </span>
                    <span className="shrink-0 text-white/60">
                      {s.wins}-{s.losses} · {s.pointsFor.toFixed(1)} PF
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border border-[#1E2A42] bg-[#131929] p-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#8B9DB8]">
                Week {week} matchups
              </p>
              {displayMatchups ? (
                <ul className="space-y-1" data-testid="matchup-list">
                  {displayMatchups.map((m) => {
                    const key = `${m.homeTeam}__${m.awayTeam ?? 'bye'}`
                    const isOpen = expandedKey === key
                    const hasBreakdown = !!(m.homeRosterId || m.awayRosterId)
                    return (
                      <li key={key}>
                        <button
                          type="button"
                          onClick={() => setExpandedKey(isOpen ? null : key)}
                          className="flex w-full items-center justify-between gap-2 rounded-lg px-1.5 py-1.5 text-left text-[13px] transition hover:bg-white/[0.04]"
                          aria-expanded={isOpen}
                        >
                          <span className="min-w-0 truncate">
                            <span className="font-semibold text-white/90">{m.homeTeam}</span>
                            {m.awayTeam ? <span className="text-white/45"> vs {m.awayTeam}</span> : null}
                          </span>
                          <span className="flex shrink-0 items-center gap-1.5">
                            <span className="font-semibold text-cyan-200/90">
                              {m.homeScore.toFixed(1)}
                              {m.awayScore != null ? (
                                <span className="ml-1 text-white/55">– {m.awayScore.toFixed(1)}</span>
                              ) : null}
                            </span>
                            {hasBreakdown ? (
                              isOpen
                                ? <ChevronUp className="h-3.5 w-3.5 text-white/30" aria-hidden />
                                : <ChevronDown className="h-3.5 w-3.5 text-white/30" aria-hidden />
                            ) : null}
                          </span>
                        </button>
                        {isOpen && hasBreakdown ? (
                          <div className="mt-1 grid gap-3 border-t border-white/[0.06] pt-2 text-[11px] sm:grid-cols-2" data-testid="matchup-breakdown">
                            {m.homeRosterId ? (
                              <div>
                                <p className="mb-1 truncate text-[10px] font-bold uppercase tracking-wide text-white/40">{m.homeTeam}</p>
                                <PlayerBreakdownPanel leagueId={leagueId} rosterId={m.homeRosterId} week={week} season={season} cache={breakdownCache} setCache={setBreakdownCache} />
                              </div>
                            ) : null}
                            {m.awayRosterId ? (
                              <div>
                                <p className="mb-1 truncate text-[10px] font-bold uppercase tracking-wide text-white/40">{m.awayTeam ?? 'Away'}</p>
                                <PlayerBreakdownPanel leagueId={leagueId} rosterId={m.awayRosterId} week={week} season={season} cache={breakdownCache} setCache={setBreakdownCache} />
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <ul className="space-y-1.5 text-[13px] text-white/90">
                  {matchups.slice(0, 4).map((m) => (
                    <li key={`${m.teamName}-${m.opponentName}`} className="flex justify-between gap-2">
                      <span className="truncate">
                        {m.teamName}
                        {m.opponentName ? <span className="text-white/45"> vs {m.opponentName}</span> : null}
                      </span>
                      <span className="shrink-0 font-semibold text-cyan-200/90">
                        {m.totalPoints.toFixed(1)}
                        {m.winLoss ? <span className="ml-1 text-[11px] text-white/45">({m.winLoss})</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
