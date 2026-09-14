import 'server-only'

import { prisma } from '@/lib/prisma'
import { listPlayerFollows } from '@/lib/follows/playerFollows'
import { resolveInjuryFacts } from '@/lib/injuries/injuryReadPort'
import { normalizeMatchName } from '@/lib/player-match/verifiedNameMatch'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'
import { buildNextGameMap } from './nextGameMap'

/**
 * The home "Following" card — the players you follow, with their status and next game
 * (user decisions, 2026-09-14).
 *
 * ⚠ `null` MEANS "FOLLOWS ARE UNAVAILABLE", AND THE CARD IS THEN NOT RENDERED. Before the
 * `player_follows` migration is applied there is no list to show, and an empty card saying
 * "follow players from any card" would advertise a star that cannot save.
 *
 * ⚠ A MISSING STATUS IS NOT "HEALTHY". The injury port returns no fact for a player with no
 * report, and a null status for a report with no designation — neither is a clean bill of
 * health, so the row shows nothing rather than "Active". When the feed itself cannot answer
 * (stale, or no source for the sport), `statusCoverage` says so and the card prints why.
 *
 * Same sources as the brief and the player card: `resolveInjuryFacts` for status, and the
 * shared `buildNextGameMap` over `SportsGame` for the next fixture (which folds the up-to-four
 * provider rows per game). NFL only for both, like those surfaces.
 */

export type FollowingRow = {
  sport: string
  playerKey: string
  sleeperId: string | null
  externalId: string | null
  name: string
  position: string | null
  team: string | null
  /** The reported designation (e.g. QUESTIONABLE), or null when none is reported or it cannot be read. */
  status: string | null
  /** "vs KC · Sun" / "@ BUF · Mon", or null when no fixture is on file in the window. */
  next: string | null
}

export type FollowingCardData = {
  rows: FollowingRow[]
  /** Every follow, not only the rows shown. */
  total: number
  /** 'unavailable' when the injury feed cannot answer right now, so a blank status is explained. */
  statusCoverage: 'ok' | 'unavailable'
}

export const FOLLOWING_SHOWN = 6
const NEXT_GAME_DAYS = 10

const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'America/New_York' })

export async function getFollowingCard(userId: string, now: Date): Promise<FollowingCardData | null> {
  const follows = await listPlayerFollows(userId)
  if (follows === null) return null

  const shown = follows.slice(0, FOLLOWING_SHOWN)
  const nfl = shown.filter((f) => f.sport === 'NFL')

  const [injuries, games] = await Promise.all([
    nfl.length > 0
      ? resolveInjuryFacts({
          sport: 'NFL',
          players: nfl.map((f) => ({ name: f.name, position: f.position, team: f.team })),
          now,
        }).catch(() => null)
      : Promise.resolve(null),
    nfl.some((f) => normalizeTeamAbbrev(f.team))
      ? prisma.sportsGame
          .findMany({
            where: { sport: 'NFL', startTime: { gte: now, lte: new Date(now.getTime() + NEXT_GAME_DAYS * 86_400_000) } },
            select: { homeTeam: true, awayTeam: true, startTime: true, seasonType: true, venue: true },
          })
          .catch(() => [])
      : Promise.resolve([]),
  ])

  const statusReadable = nfl.length === 0 || Boolean(injuries?.coverage.sourceAvailable && !injuries.feedStale)
  const clubs = new Set(nfl.map((f) => normalizeTeamAbbrev(f.team)).filter((c): c is string => Boolean(c)))
  const nextByClub = buildNextGameMap(games, clubs)

  const rows: FollowingRow[] = shown.map((f) => {
    let status: string | null = null
    let next: string | null = null
    if (f.sport === 'NFL') {
      if (statusReadable && injuries) {
        const fact = injuries.byPlayer.get(normalizeMatchName(f.name))
        if (fact && !fact.stale && fact.status) status = String(fact.status).trim().toUpperCase()
      }
      const club = normalizeTeamAbbrev(f.team)
      const game = club ? nextByClub.get(club) : undefined
      if (game) {
        next = `${game.home ? 'vs' : '@'} ${game.opponent} · ${weekday.format(game.at)}${game.preseason ? ' (pre)' : ''}`
      }
    }
    return {
      sport: f.sport,
      playerKey: f.playerKey,
      sleeperId: f.sleeperId,
      externalId: f.externalId,
      name: f.name,
      position: f.position,
      team: f.team,
      status,
      next,
    }
  })

  return { rows, total: follows.length, statusCoverage: statusReadable ? 'ok' : 'unavailable' }
}
