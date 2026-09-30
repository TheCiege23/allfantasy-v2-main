import type { PlayFeedItem } from '@/lib/live/playFeedPresentation'
import type { LiveGameCard, LiveImpact, LivePlay } from '@/lib/live/liveScoresPage'
import { liveTeamAbbreviation } from '@/lib/live/teamAbbreviation'
import { normalizeMatchName } from '@/lib/player-match/verifiedNameMatch'

/**
 * The "Your live impact" panel, derived from the slate — pure, so the server
 * builds it for the whole slate and the client rebuilds it for one league from
 * the same rule. Two implementations of one panel is how they drift.
 */

/*
 * A play from before this game kicked off is not this game's play. The feed is
 * a rolling cache keyed by sport; a team's play from LAST week must not attach
 * to its game this week just because the abbreviation matches.
 */
const PRE_KICKOFF_TOLERANCE_MS = 15 * 60 * 1000

/**
 * Which slate game each play happened in.
 *
 * ⚠ BY TEAM, BECAUSE THE IDS CANNOT MEET. The play feed carries Rolling Insights
 * game ids; an ESPN-sourced slate carries ESPN event ids. `buildImpact` documented
 * that mismatch and then joined on `gameId` anyway for "Biggest mover", so the
 * card could only render on the rare slate served from Rolling Insights rows — on
 * an ESPN slate it was absent every time, which reads as a quiet afternoon rather
 * than a broken join. A team plays once per slate, so its abbreviation places a
 * play in exactly one game.
 *
 * The play's team comes from the feed (backfilled from the identity map), else
 * from the user's own roster by normalised name — never guessed. A play that
 * resolves to no team, or to a game that has not kicked off, stays unattached.
 */
export function attachSlateGames(
  plays: readonly PlayFeedItem[],
  games: readonly Pick<LiveGameCard, 'gameId' | 'home' | 'away' | 'startTime' | 'isLive' | 'completed'>[],
  sport: string,
  rosterTeamByName: ReadonlyMap<string, string>,
): LivePlay[] {
  const gameByTeam = new Map<string, (typeof games)[number]>()
  for (const g of games) {
    gameByTeam.set(liveTeamAbbreviation(g.home.abbrev, sport), g)
    gameByTeam.set(liveTeamAbbreviation(g.away.abbrev, sport), g)
  }
  return plays.map((p) => {
    const team = p.team ?? rosterTeamByName.get(normalizeMatchName(p.playerName) ?? '') ?? null
    const game = team ? gameByTeam.get(liveTeamAbbreviation(team, sport)) : undefined
    const started = game != null && (game.isLive || game.completed)
    const kickoff = game ? new Date(game.startTime).getTime() : NaN
    const at = new Date(p.detectedAt).getTime()
    const inGame =
      started && (!Number.isFinite(kickoff) || !Number.isFinite(at) || at >= kickoff - PRE_KICKOFF_TOLERANCE_MS)
    return { ...p, slateGameId: inGame ? game!.gameId : null }
  })
}

/**
 * The panel for a set of games.
 *
 * `onlyTheseGamesPlays` narrows the play feed to plays from these games. The
 * cross-league view keeps the whole feed (it is "Live plays", league-wide news);
 * a league-scoped view narrows it, or the panel beside one league's games would
 * narrate everyone else's.
 */
export function deriveImpact(
  games: readonly LiveGameCard[],
  plays: readonly LivePlay[],
  opts: { onlyTheseGamesPlays: boolean },
): LiveImpact {
  const liveGames = games.filter((g) => g.isLive)

  /*
   * ⚠ SUMMED PER (PLAYER, LEAGUE), NOT PER PLAYER. The same player in three
   * leagues contributes three separate scores, because that is three separate
   * matchups of yours he is affecting. Deduplicating to one would understate the
   * total by exactly the amount that makes this page worth opening.
   */
  let totalPoints = 0
  const livePlayerIds = new Set<string>()
  for (const g of liveGames) {
    for (const t of g.tieIns) {
      if (t.points != null) totalPoints += t.points
      livePlayerIds.add(t.playerId)
    }
  }

  const gameIds = new Set(games.map((g) => g.gameId))
  const shownPlays = opts.onlyTheseGamesPlays
    ? plays.filter((p) => p.slateGameId != null && gameIds.has(p.slateGameId))
    : [...plays]

  /*
   * The newest play by one of YOUR STARTERS, in a game that is live now. The
   * feed is newest-first, so the first hit is the latest. Starters only, the
   * same rule as the tie-ins it is read from: a bench player's touchdown does
   * not move a matchup of yours.
   */
  const liveById = new Map(liveGames.map((g) => [g.gameId, g]))
  let biggestMover: LiveImpact['biggestMover'] = null
  for (const p of shownPlays) {
    const game = p.slateGameId ? liveById.get(p.slateGameId) : undefined
    if (!game) continue
    const key = normalizeMatchName(p.playerName)
    if (!key) continue
    const mine = game.tieIns.filter((t) => normalizeMatchName(t.playerName) === key)
    if (mine.length === 0) continue
    biggestMover = { ...p, leagues: [...new Set(mine.map((t) => t.leagueName))] }
    break
  }

  const upNext = games
    .filter((g) => !g.isLive && !g.completed && g.tieIns.length > 0)
    .slice(0, 3)
    .map((g) => ({
      playerName: g.tieIns[0]!.playerName,
      matchup: `${g.away.abbrev} @ ${g.home.abbrev}`,
      startTime: g.startTime,
    }))

  return {
    totalPoints: Math.round(totalPoints * 10) / 10,
    livePlayers: livePlayerIds.size,
    liveGames: liveGames.length,
    biggestMover,
    plays: shownPlays,
    upNext,
  }
}
