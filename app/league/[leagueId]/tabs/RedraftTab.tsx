'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRedraftStream } from '@/lib/hooks/useRedraftStream'
import { MatchupView } from './redraft/MatchupView'
import { extraMatchupForRoster } from '@/lib/redraft/oddTeamExtraMatchupRules'
import { RosterManager } from './redraft/RosterManager'
import { ScheduleView } from './redraft/ScheduleView'
import { StandingsView } from './redraft/StandingsView'
import { TradeCenter } from './redraft/TradeCenter'
import { WaiverCenter } from './redraft/WaiverCenter'
import { IDPWaiverSection } from '@/components/idp/IDPWaiverSection'
import {
  LeagueDashboardPremiumShells,
  MatchupPremiumShells,
  TeamPagePremiumShells,
  TradePremiumShells,
  WaiverPremiumShells,
} from '@/components/redraft-premium'
import { PlayoffSeriesStrip } from '@/components/league/PlayoffSeriesStrip'
import {
  fetchRedraftLiveScoring,
  fetchRedraftMatchups,
  fetchRedraftPlayoffRuntime,
  type RedraftPlayoffRuntimeClient,
  fetchRedraftRoster,
  fetchRedraftSchedule,
  fetchRedraftSeason,
  fetchRedraftStandings,
  type RedraftLiveScoringClient,
  type RedraftMatchupClient,
  type RedraftRosterClient,
  type RedraftRosterRow,
  type RedraftScheduleClient,
  type RedraftSeasonClient,
} from '@/lib/redraft/client'

export function RedraftTab({ leagueId, idpLeagueUi = false }: { leagueId: string; idpLeagueUi?: boolean }) {
  const [season, setSeason] = useState<RedraftSeasonClient | null>(null)
  const [standings, setStandings] = useState<RedraftRosterRow[]>([])
  const [matchups, setMatchups] = useState<RedraftMatchupClient[]>([])
  const [liveScoring, setLiveScoring] = useState<RedraftLiveScoringClient | null>(null)
  const [schedule, setSchedule] = useState<RedraftScheduleClient | null>(null)
  const [selectedRosterId, setSelectedRosterId] = useState<string | null>(null)
  const [selectedRoster, setSelectedRoster] = useState<RedraftRosterClient | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const seasonId = season?.id ?? null
  const currentWeek = Math.max(1, season?.currentWeek || 1)
  const sport = season?.sport ?? 'NFL'

  useRedraftStream(seasonId)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const nextSeason = await fetchRedraftSeason(leagueId)
        if (cancelled) return
        setSeason(nextSeason)
        setSelectedRosterId((prev) => prev ?? nextSeason?.rosters?.[0]?.id ?? null)
      } catch (err) {
        if (!cancelled) {
          setSeason(null)
          setSelectedRosterId(null)
          setError(err instanceof Error ? err.message : 'Unable to load redraft season.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [leagueId])

  useEffect(() => {
    if (!seasonId) return
    let cancelled = false
    ;(async () => {
      try {
        const [rows, weeklyMatchups, scoring] = await Promise.all([
          fetchRedraftStandings(seasonId),
          fetchRedraftMatchups(seasonId, currentWeek),
          season?.source === 'fantrax' ? Promise.resolve(null) : fetchRedraftLiveScoring({ leagueId, seasonId, week: currentWeek }).catch(() => null),
        ])
        if (!cancelled) {
          setStandings(rows)
          setMatchups(weeklyMatchups)
          setLiveScoring(scoring)
        }
      } catch {
        if (!cancelled) {
          setStandings([])
          setMatchups([])
          setLiveScoring(null)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [leagueId, seasonId, currentWeek, season?.source])

  // Best-of-N playoff series (lib/playoff-runtime/playoffSeries.ts): the bracket, read only while the
  // season is in its playoffs, so the matchup screen can show the selected team's series record.
  const [playoffRuntime, setPlayoffRuntime] = useState<RedraftPlayoffRuntimeClient | null>(null)
  const inPlayoffs = season?.status === 'playoffs'
  useEffect(() => {
    if (!seasonId || !inPlayoffs) {
      setPlayoffRuntime(null)
      return
    }
    let cancelled = false
    fetchRedraftPlayoffRuntime({ seasonId })
      .then((runtime) => {
        if (!cancelled) setPlayoffRuntime(runtime)
      })
      .catch(() => {
        if (!cancelled) setPlayoffRuntime(null)
      })
    return () => {
      cancelled = true
    }
  }, [seasonId, inPlayoffs, currentWeek])

  useEffect(() => {
    if (!seasonId) {
      setSchedule(null)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const nextSchedule = await fetchRedraftSchedule(leagueId, seasonId)
        if (!cancelled) setSchedule(nextSchedule)
      } catch {
        if (!cancelled) setSchedule(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [leagueId, seasonId])

  useEffect(() => {
    if (!selectedRosterId) {
      setSelectedRoster(null)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const roster = await fetchRedraftRoster(selectedRosterId, currentWeek)
        if (!cancelled) setSelectedRoster(roster)
      } catch {
        if (!cancelled) setSelectedRoster(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selectedRosterId, currentWeek])

  /*
   * Every game the selected team plays this week. One in an ordinary league; several in a league that
   * plays more than one game a week (settings: games per team each week), where each is its own
   * result. The league-median game is not a head-to-head and is left out.
   */
  const myWeekGames = useMemo(
    () => (selectedRosterId
      ? matchups.filter((m) => !(m as { isMedianMatchup?: boolean | null }).isMedianMatchup && m.awayRosterId != null
          && (m.homeRosterId === selectedRosterId || m.awayRosterId === selectedRosterId))
      : []),
    [matchups, selectedRosterId],
  )
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null)
  const visibleMatchup = useMemo(() => {
    if (!selectedRosterId) return matchups[0] ?? null
    return (
      myWeekGames.find((m) => m.id === selectedGameId) ??
      matchups.find((m) => m.homeRosterId === selectedRosterId || m.awayRosterId === selectedRosterId) ??
      matchups[0] ??
      null
    )
  }, [matchups, myWeekGames, selectedGameId, selectedRosterId])

  // An odd-team league's extra game, in place of the bye (lib/redraft/oddTeamExtraMatchupRules.ts).
  const extraMatchup = useMemo(() => {
    if (!selectedRosterId) return null
    const names = new Map<string, string>()
    for (const m of matchups) {
      names.set(m.homeRosterId, m.homeRoster?.teamName?.trim() || m.homeRoster?.ownerName || '')
      if (m.awayRosterId && m.awayRoster) names.set(m.awayRosterId, m.awayRoster.teamName?.trim() || m.awayRoster.ownerName || '')
    }
    return extraMatchupForRoster(matchups, currentWeek, selectedRosterId, (id) => names.get(id))
  }, [matchups, currentWeek, selectedRosterId])

  const visibleLiveMatchup = useMemo(() => {
    const liveMatchups = liveScoring?.matchups ?? []
    if (!selectedRosterId) return liveMatchups[0] ?? null
    // The live game for the SAME pairing as the game on screen, so the score and the names agree.
    const samePairing = visibleMatchup
      ? liveMatchups.find((m) => m.homeRosterId === visibleMatchup.homeRosterId && m.awayRosterId === visibleMatchup.awayRosterId)
      : undefined
    return (
      samePairing ??
      (myWeekGames.length > 1 ? undefined : liveMatchups.find((m) => m.homeRosterId === selectedRosterId || m.awayRosterId === selectedRosterId)) ??
      (myWeekGames.length > 1 ? null : liveMatchups[0]) ??
      null
    )
  }, [liveScoring, selectedRosterId, visibleMatchup, myWeekGames.length])

  return (
    <div className="space-y-4 px-4 py-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-bold text-white">Season Hub</h2>
          <p className="text-[11px] text-white/45">
            Track matchups, rosters, waivers, trades, standings, and playoffs from one place.
          </p>
        </div>
        {season?.rosters?.length ? (
          <label className="flex items-center gap-2 text-[11px] text-white/55">
            Roster
            <select
              value={selectedRosterId ?? ''}
              onChange={(event) => setSelectedRosterId(event.target.value || null)}
              className="rounded-lg border border-white/15 bg-black/40 px-2 py-1 text-[11px] text-white"
            >
              {season.rosters.map((roster) => (
                <option key={roster.id} value={roster.id}>
                  {roster.teamName ?? roster.ownerName ?? roster.id.slice(0, 6)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {loading ? (
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 text-[12px] text-white/50">
          Getting your season ready...
        </div>
      ) : error ? (
        <div className="rounded-xl border border-rose-400/25 bg-rose-500/10 p-4 text-[12px] text-rose-100">
          We could not load this redraft season. Refresh and try again. {error}
        </div>
      ) : !season ? (
        <div className="rounded-xl border border-amber-300/25 bg-amber-400/10 p-4 text-[12px] text-amber-100">
          Draft results have not been finalized into a redraft season yet. Once the draft is complete, rosters, schedule, waivers, trades, and standings will appear here.
        </div>
      ) : null}

      {loading || error || !season ? null : (
        <>
          <LeagueDashboardPremiumShells
            leagueId={leagueId}
            teamId={selectedRosterId}
            week={currentWeek}
            season={season.season}
            compact
          />

          {playoffRuntime?.settings?.seriesLengths ? (
            <PlayoffSeriesStrip
              seriesLengths={playoffRuntime.settings.seriesLengths}
              matchups={[
                ...playoffRuntime.bracket.rounds.flatMap((round) => round.matchups),
                ...(playoffRuntime.bracket.thirdPlaceMatchup ? [playoffRuntime.bracket.thirdPlaceMatchup] : []),
                ...(playoffRuntime.bracket.consolationRounds ?? []).flatMap((round) => round.matchups),
              ]}
              rosterId={selectedRosterId}
              nameOf={(rosterId) =>
                playoffRuntime.teams.find((team) => team.rosterId === rosterId)?.displayName ?? (rosterId ? rosterId.slice(0, 6) : '')
              }
            />
          ) : null}

          {myWeekGames.length > 1 ? (
            <nav aria-label="This week's games" data-testid="redraft-week-games" className="rounded-2xl border border-white/10 bg-[#0a1220] p-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/60">This week&apos;s games ({myWeekGames.length})</p>
              <ul className="mt-2 grid gap-2">
                {myWeekGames.map((game, index) => {
                  const home = game.homeRosterId === selectedRosterId
                  const opponent = home ? game.awayRoster : game.homeRoster
                  const mine = home ? game.homeScore : game.awayScore
                  const theirs = home ? game.awayScore : game.homeScore
                  const open = game.id === visibleMatchup?.id
                  return (
                    <li key={game.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedGameId(game.id)}
                        aria-pressed={open}
                        data-testid={`redraft-week-game-${index + 1}`}
                        className={`flex min-h-[44px] w-full flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-[13px] ${open ? 'border-[#ff9ec0]/60 bg-[#ff3d81]/10 font-semibold text-white' : 'border-white/10 text-white/80'}`}
                      >
                        <span>Game {index + 1} · vs {opponent?.teamName?.trim() || opponent?.ownerName || 'Opponent'}</span>
                        <span className="tabular-nums">
                          {mine != null && theirs != null
                            ? `${mine.toFixed(1)} – ${theirs.toFixed(1)} · ${mine > theirs ? 'Win' : mine < theirs ? 'Loss' : 'Tie'}`
                            : 'Not final'}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </nav>
          ) : null}

          <MatchupView
            matchup={visibleMatchup}
            liveMatchup={visibleLiveMatchup}
            selectedRosterId={selectedRosterId}
            sport={sport}
            extraMatchup={extraMatchup}
          />

          <MatchupPremiumShells
            leagueId={leagueId}
            teamId={selectedRosterId}
            matchupId={visibleMatchup?.id ?? null}
            week={currentWeek}
            season={season.season}
            compact
          />

          <ScheduleView schedule={schedule} />

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-3">
              <RosterManager roster={selectedRoster} week={currentWeek} />
              <TeamPagePremiumShells
                leagueId={leagueId}
                teamId={selectedRosterId}
                week={currentWeek}
                season={season.season}
                compact
              />
            </div>
            <div className="space-y-3">
              <WaiverCenter
                seasonId={seasonId}
                leagueId={leagueId}
                rosterId={selectedRosterId}
                sport={sport}
              />
              <WaiverPremiumShells
                leagueId={leagueId}
                teamId={selectedRosterId}
                week={currentWeek}
                season={season.season}
                compact
              />
              {idpLeagueUi ? <IDPWaiverSection leagueId={leagueId} week={currentWeek} /> : null}
            </div>
          </div>

          <TradeCenter
            leagueId={leagueId}
            seasonId={seasonId}
            standings={standings}
            currentWeek={currentWeek}
            myRosterId={selectedRosterId}
          />
          <TradePremiumShells
            leagueId={leagueId}
            teamId={selectedRosterId}
            week={currentWeek}
            season={season.season}
            compact
          />

          <StandingsView rows={standings} seasonId={seasonId} />
        </>
      )}
    </div>
  )
}
