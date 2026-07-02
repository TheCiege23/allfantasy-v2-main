'use client'

import { isWeatherSensitiveSport } from '@/lib/weather/outdoorSportMetadata'
import type { RedraftLiveScoringClient, RedraftMatchupClient } from '@/lib/redraft/client'

type LiveMatchup = RedraftLiveScoringClient['matchups'][number]
type LiveTeam = LiveMatchup['home']

function rosterLabel(matchup: RedraftMatchupClient, side: 'home' | 'away') {
  const roster = side === 'home' ? matchup.homeRoster : matchup.awayRoster
  return roster?.teamName ?? roster?.ownerName ?? (side === 'home' ? 'Home roster' : 'Away roster')
}

function scoringSnapshot(matchup: RedraftMatchupClient | null) {
  const raw = matchup?.lineupSnapshots
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const scoring = (raw as Record<string, unknown>).redraftScoring
  return scoring && typeof scoring === 'object' && !Array.isArray(scoring)
    ? (scoring as Record<string, unknown>)
    : null
}

function liveTeamLabel(team: LiveTeam | null | undefined, fallback: string) {
  return team?.displayName ?? team?.ownerName ?? fallback
}

function PlayerScoreRows({ title, players }: { title: string; players: LiveTeam['starters'] }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/45">{title}</p>
        <p className="text-[10px] text-white/35">{players.length}</p>
      </div>
      <div className="space-y-1.5">
        {players.length ? (
          players.map((player) => (
            <div
              key={`${title}-${player.playerId}`}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.03] px-2 py-1.5"
            >
              <div className="min-w-0">
                <p className="truncate text-[11px] font-semibold text-white/80">{player.playerName}</p>
                <p className="text-[10px] text-white/35">
                  {player.position}
                  {player.team ? ` - ${player.team}` : ''} - {player.hasStats ? (player.isFinalized ? 'final' : 'live') : 'waiting'}
                </p>
              </div>
              <p className="text-right text-[12px] font-bold text-white">{player.fantasyPoints.toFixed(2)}</p>
            </div>
          ))
        ) : (
          <p className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-2 py-2 text-[11px] text-white/35">
            No players in this section.
          </p>
        )}
      </div>
    </div>
  )
}

export function MatchupView({
  matchup,
  liveMatchup,
  selectedRosterId,
  sport,
}: {
  matchup: RedraftMatchupClient | null
  liveMatchup?: LiveMatchup | null
  selectedRosterId: string | null
  sport: string
}) {
  const showAfHint = isWeatherSensitiveSport(sport)
  const snapshot = scoringSnapshot(matchup)
  const missing = Array.isArray(snapshot?.missingPlayerIds) ? snapshot.missingPlayerIds.length : 0
  const isSelectedAway = (liveMatchup?.awayRosterId ?? matchup?.awayRosterId) === selectedRosterId
  const selectedLiveTeam = liveMatchup ? (isSelectedAway ? liveMatchup.away : liveMatchup.home) : null
  const opponentLiveTeam = liveMatchup ? (isSelectedAway ? liveMatchup.home : liveMatchup.away) : null
  const selectedScore = liveMatchup
    ? isSelectedAway
      ? liveMatchup.awayScore ?? 0
      : liveMatchup.homeScore
    : matchup
      ? isSelectedAway
        ? matchup.awayScore
        : matchup.homeScore
      : 0
  const opponentScore = liveMatchup
    ? isSelectedAway
      ? liveMatchup.homeScore
      : liveMatchup.awayScore ?? 0
    : matchup
      ? isSelectedAway
        ? matchup.homeScore
        : matchup.awayScore
      : 0
  const selectedName = liveMatchup
    ? liveTeamLabel(selectedLiveTeam, 'Your roster')
    : matchup
      ? rosterLabel(matchup, isSelectedAway ? 'away' : 'home')
      : 'Your roster'
  const opponentName = liveMatchup
    ? liveTeamLabel(opponentLiveTeam, liveMatchup.awayRosterId ? 'Opponent' : 'Bye')
    : matchup
      ? rosterLabel(matchup, isSelectedAway ? 'home' : 'away')
      : 'Opponent'
  const liveMissing = liveMatchup?.missingStarterPlayerIds.length ?? 0
  const finalWinner =
    liveMatchup?.complete && liveMatchup.winnerRosterId
      ? liveMatchup.winnerRosterId === selectedRosterId
        ? selectedName
        : opponentName
      : null

  return (
    <div className="space-y-3">
      <div
        className="rounded-2xl border border-cyan-300/15 bg-[#0a1220] p-4 shadow-[0_0_32px_rgba(34,211,238,0.08)]"
        data-testid={liveMatchup ? 'redraft-live-scoring-view' : undefined}
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-200/70">Week matchup</p>
            <p className="text-[11px] text-white/40">
              {liveMatchup
                ? `Week ${liveMatchup.week} - ${liveMatchup.status.replace(/_/g, ' ')}`
                : matchup
                  ? `Week ${matchup.week} - ${matchup.status}`
                  : 'No matchup scheduled for this week.'}
            </p>
          </div>
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] font-semibold text-white/55">
            {sport}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="text-center">
            <p className="truncate text-[11px] text-white/50">{selectedName}</p>
            <p className="text-2xl font-bold text-white">{selectedScore.toFixed(2)}</p>
          </div>
          <div className="flex flex-col items-center justify-center text-white/35">
            <span className="text-xs uppercase">vs</span>
            <span className="text-[10px]">{liveMatchup ? 'live scoring' : 'cached scoring'}</span>
          </div>
          <div className="text-center">
            <p className="truncate text-[11px] text-white/50">{opponentName}</p>
            <p className="text-2xl font-bold text-white">{opponentScore.toFixed(2)}</p>
          </div>
        </div>

        {missing > 0 ? (
          <p className="mt-3 rounded-lg border border-amber-300/20 bg-amber-400/10 px-3 py-2 text-[11px] text-amber-100">
            {missing} starter score{missing === 1 ? '' : 's'} still missing from the cache. Run NFL score sync
            after the weekly stat cache is refreshed.
          </p>
        ) : null}

        {liveMatchup ? (
          <div className="mt-4 space-y-3 border-t border-white/[0.08] pt-3">
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3">
                <p className="text-[10px] uppercase tracking-[0.15em] text-white/35">Starter total</p>
                <p className="mt-1 text-lg font-bold text-white">{selectedLiveTeam?.starterTotal.toFixed(2) ?? selectedScore.toFixed(2)}</p>
              </div>
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3">
                <p className="text-[10px] uppercase tracking-[0.15em] text-white/35">Bench points</p>
                <p className="mt-1 text-lg font-bold text-white">{(selectedLiveTeam?.benchTotal ?? 0).toFixed(2)}</p>
              </div>
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3">
                <p className="text-[10px] uppercase tracking-[0.15em] text-white/35">Result</p>
                <p className="mt-1 truncate text-[12px] font-semibold text-white/75">
                  {liveMatchup.complete
                    ? liveMatchup.tied
                      ? 'Final tie'
                      : `Winner: ${finalWinner ?? 'resolved'}`
                    : liveMissing > 0
                      ? `${liveMissing} starter score${liveMissing === 1 ? '' : 's'} pending`
                      : 'In progress'}
                </p>
              </div>
            </div>

            {selectedLiveTeam && !selectedLiveTeam.lineupLegal ? (
              <p className="rounded-lg border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-100">
                This lineup is flagged for scoring review: {selectedLiveTeam.illegalLineupIssues.map((issue) => issue.message).join(' ')}
              </p>
            ) : null}

            {liveMatchup.correctionVersion > 0 ? (
              <p className="rounded-lg border border-amber-300/20 bg-amber-400/10 px-3 py-2 text-[11px] text-amber-100">
                Stat correction version {liveMatchup.correctionVersion} is applied to this matchup.
              </p>
            ) : null}

            <div className="grid gap-3 lg:grid-cols-2">
              <div className="space-y-3">
                <p className="truncate text-[11px] font-bold text-cyan-100">{selectedName}</p>
                <PlayerScoreRows title="Starters" players={selectedLiveTeam?.starters ?? []} />
                <PlayerScoreRows title="Bench" players={selectedLiveTeam?.bench ?? []} />
              </div>
              <div className="space-y-3">
                <p className="truncate text-[11px] font-bold text-cyan-100">{opponentName}</p>
                <PlayerScoreRows title="Starters" players={opponentLiveTeam?.starters ?? []} />
                <PlayerScoreRows title="Bench" players={opponentLiveTeam?.bench ?? []} />
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {showAfHint ? (
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-white/35">
          <span className="bg-gradient-to-r from-cyan-400 to-violet-400 bg-clip-text text-[10px] font-bold text-transparent">
            AF
          </span>
          <span>Weather-sensitive scoring surfaces use cached data before any AI analysis.</span>
        </div>
      ) : null}
    </div>
  )
}
