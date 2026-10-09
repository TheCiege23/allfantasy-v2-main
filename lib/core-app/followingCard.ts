import 'server-only'

import { prisma } from '@/lib/prisma'
import { listPlayerFollows } from '@/lib/follows/playerFollows'
import { resolveInjuryFacts } from '@/lib/injuries/injuryReadPort'
import { normalizeMatchName } from '@/lib/player-match/verifiedNameMatch'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'
import { leagueDisplayName } from './leagueHome'
import { buildNextGameMap } from './nextGameMap'
import { rosterIdCoverage, sampleRosterIds } from './rosterIdCoverage'
import { collectRosterIds, translateRostersByLeague } from './rosterIdSpace'

/**
 * The home "Following" card — the players you follow, with their status, next game, and
 * whether he is sitting unclaimed in one of your leagues (user decisions, 2026-09-14).
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

export type FollowingFreeAgentLeague = {
  leagueId: string
  leagueName: string
  /** Core's waiver screen for that league — where a claim starts. */
  href: string
}

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
  /**
   * What `next` was built from (2026-10-04), so the card can say it in the reader's language: `next`
   * stays the English as written and lib/core-app/dashboard3aCopy.ts rebuilds the Spanish from this.
   * `weekday` is the pinned en-US short weekday ("Sun"). Absent whenever `next` is null.
   */
  nextParts?: { home: boolean; opponent: string; weekday: string; preseason: boolean }
  /**
   * Your leagues where he is on NO roster (the waiver nudge, 2026-09-14). Empty when he is
   * rostered everywhere, or wherever that cannot be established — see `freeAgentLeaguesFor`.
   */
  freeAgentIn: FollowingFreeAgentLeague[]
}

export type FollowingCardData = {
  rows: FollowingRow[]
  /** Every follow, not only the rows shown. */
  total: number
  /** 'unavailable' when the injury feed cannot answer right now, so a blank status is explained. */
  statusCoverage: 'ok' | 'unavailable'
}

/** A league as the home already has it. */
export type FollowingLeague = { id: string; name: string | null; platform: string | null; sport?: string | null }

export const FOLLOWING_SHOWN = 6
/** Leagues checked for the waiver nudge per render — one roster read covers all of them. */
export const MAX_FREE_AGENT_LEAGUES = 12
const NEXT_GAME_DAYS = 10
/** Ids sampled per league to decide whether its rosters speak Sleeper ids. */
const COVERAGE_SAMPLE = 60

const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'America/New_York' })

/**
 * For each followed Sleeper id: your leagues where he is on nobody's roster.
 *
 * ⚠ "FREE AGENT" IS A CLAIM, MADE ONLY WHEN EVERY ROSTER CAN BE READ — the rule
 * `playerLeagueView` already states, plus one it does not need. A league is skipped (never
 * reports him free) when:
 *   - you have no claimed team in it — the nudge is about YOUR leagues;
 *   - fewer rosters are imported than the league has teams — a partial import would make
 *     every player on a missing roster look unclaimed;
 *   - its rosters do not speak Sleeper ids even after the ESPN translation (`rosterIdCoverage`)
 *     — a Sleeper-id miss there is not evidence of anything.
 * NFL leagues only, like every other Sleeper-id read here. Any failed read skips the nudge.
 */
export async function freeAgentLeaguesFor(
  userId: string,
  leagues: readonly FollowingLeague[],
  sleeperIds: readonly string[],
): Promise<Map<string, FollowingFreeAgentLeague[]>> {
  return (await scanFreeAgentLeagues(userId, leagues, sleeperIds)).free
}

/**
 * `freeAgentLeaguesFor`, plus the leagues it could actually READ (`checked`). The "he's free in
 * your league" alert (lib/follows/followFreeAgentCheck.ts) needs both: a league that drops out of
 * `free` because it became unreadable is not a league where he was picked up, and one that comes
 * back is not a league where he was dropped. Only a league read on both sides can say either.
 */
export async function scanFreeAgentLeagues(
  userId: string,
  leagues: readonly FollowingLeague[],
  sleeperIds: readonly string[],
): Promise<{ free: Map<string, FollowingFreeAgentLeague[]>; checked: string[] }> {
  const out = new Map<string, FollowingFreeAgentLeague[]>()
  const checked: string[] = []
  const done = () => ({ free: out, checked })
  const ids = [...new Set(sleeperIds.filter(Boolean))]
  const nfl = leagues.filter((l) => String(l.sport ?? 'NFL').toUpperCase() === 'NFL')
  if (ids.length === 0 || nfl.length === 0) return done()

  const teams = await prisma.leagueTeam
    .findMany({
      where: { leagueId: { in: nfl.map((l) => l.id) } },
      select: { leagueId: true, claimedByUserId: true },
    })
    .catch(() => null)
  if (!teams) return done()
  const teamCount = new Map<string, number>()
  const yours = new Set<string>()
  for (const t of teams) {
    teamCount.set(t.leagueId, (teamCount.get(t.leagueId) ?? 0) + 1)
    if (t.claimedByUserId === userId) yours.add(t.leagueId)
  }
  const scoped = nfl.filter((l) => yours.has(l.id)).slice(0, MAX_FREE_AGENT_LEAGUES)
  if (scoped.length === 0) return done()

  const raw = await prisma.roster
    .findMany({ where: { leagueId: { in: scoped.map((l) => l.id) } }, select: { leagueId: true, playerData: true } })
    .catch(() => null)
  if (!raw) return done()
  const rosters = await translateRostersByLeague(raw, new Map(scoped.map((l) => [l.id, l.platform]))).catch(() => null)
  if (!rosters) return done()

  const byLeague = new Map<string, unknown[]>()
  for (const r of rosters) {
    const list = byLeague.get(r.leagueId) ?? []
    list.push(r.playerData)
    byLeague.set(r.leagueId, list)
  }

  const samples = new Map(scoped.map((l) => [l.id, sampleRosterIds(byLeague.get(l.id) ?? [], COVERAGE_SAMPLE)]))
  const union = [...new Set([...samples.values()].flat())]
  const known =
    union.length > 0
      ? await prisma.sportsPlayer
          .findMany({ where: { sleeperId: { in: union } }, select: { sleeperId: true }, distinct: ['sleeperId'] })
          .catch(() => null)
      : []
  if (!known) return done()
  const knownIds = new Set(known.map((k) => k.sleeperId).filter((x): x is string => Boolean(x)))

  for (const l of scoped) {
    const pds = byLeague.get(l.id) ?? []
    const teamsInLeague = teamCount.get(l.id) ?? 0
    if (pds.length === 0 || pds.length < teamsInLeague) continue
    if (!rosterIdCoverage(samples.get(l.id) ?? [], knownIds).usable) continue
    checked.push(l.id)
    const held = new Set(collectRosterIds(pds))
    for (const id of ids) {
      if (held.has(id)) continue
      const list = out.get(id) ?? []
      list.push({
        leagueId: l.id,
        leagueName: leagueDisplayName(l.name),
        href: `/core/waivers?league=${encodeURIComponent(l.id)}`,
      })
      out.set(id, list)
    }
  }
  return done()
}

export async function getFollowingCard(
  userId: string,
  now: Date,
  leagues: readonly FollowingLeague[] = [],
): Promise<FollowingCardData | null> {
  const follows = await listPlayerFollows(userId)
  if (follows === null) return null

  const shown = follows.slice(0, FOLLOWING_SHOWN)
  const nfl = shown.filter((f) => f.sport === 'NFL')
  const followedSleeperIds = nfl.map((f) => f.sleeperId).filter((id): id is string => Boolean(id))

  const [injuries, games, freeAgents] = await Promise.all([
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
    followedSleeperIds.length > 0 && leagues.length > 0
      ? freeAgentLeaguesFor(userId, leagues, followedSleeperIds).catch(() => new Map<string, FollowingFreeAgentLeague[]>())
      : Promise.resolve(new Map<string, FollowingFreeAgentLeague[]>()),
  ])

  const statusReadable = nfl.length === 0 || Boolean(injuries?.coverage.sourceAvailable && !injuries.feedStale)
  const clubs = new Set(nfl.map((f) => normalizeTeamAbbrev(f.team)).filter((c): c is string => Boolean(c)))
  const nextByClub = buildNextGameMap(games, clubs)

  const rows: FollowingRow[] = shown.map((f) => {
    let status: string | null = null
    let next: string | null = null
    let nextParts: FollowingRow['nextParts'] | null = null
    if (f.sport === 'NFL') {
      if (statusReadable && injuries) {
        const fact = injuries.byPlayer.get(normalizeMatchName(f.name))
        if (fact && !fact.stale && fact.status) status = String(fact.status).trim().toUpperCase()
      }
      const club = normalizeTeamAbbrev(f.team)
      const game = club ? nextByClub.get(club) : undefined
      if (game) {
        const day = weekday.format(game.at)
        next = `${game.home ? 'vs' : '@'} ${game.opponent} · ${day}${game.preseason ? ' (pre)' : ''}`
        nextParts = { home: game.home, opponent: game.opponent, weekday: day, preseason: Boolean(game.preseason) }
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
      ...(nextParts ? { nextParts } : {}),
      freeAgentIn: f.sport === 'NFL' && f.sleeperId ? (freeAgents.get(f.sleeperId) ?? []) : [],
    }
  })

  return { rows, total: follows.length, statusCoverage: statusReadable ? 'ok' : 'unavailable' }
}
