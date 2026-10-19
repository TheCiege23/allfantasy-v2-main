import 'server-only'

/**
 * Reads a league's season into `RookieOrderInput` for the live rookie order engine.
 *
 * Two sources, tried in this order:
 *
 *   native   — the league's platform is AllFantasy (`isNativePlatform`): `RedraftSeason` + `RedraftRoster` +
 *              `RedraftPlayoffSeed` + `RedraftPlayoffMatchup`. Team ids are `RedraftRoster.id`.
 *   imported — the league lives on Sleeper: `LeagueTeam` + the winners bracket the history sync
 *              stored in `LeagueDynastySeason.metadata.playoffStructure`. Team ids are
 *              `LeagueTeam.id`, and true Max PF comes from `readMaxPfFreezeStatus`.
 *
 * 🛑 THE SOURCE IS CHOSEN BY PLATFORM, NOT BY WHICH ROWS EXIST. Imported leagues get
 * `RedraftSeason` rows too (`canonicalSeasonMaterialization`, ~240 of ~250 seasons in production),
 * but their playoffs are not played by the native runtime, so those rows hold no bracket.
 *
 * Each result carries `rosterIdForTeam`, the live-draft `Roster.id` for every engine team, so a
 * caller can seat the order without guessing (see `resolveRookieDraftSlotOrderForLeague`).
 *
 * ⚠ NATIVE LEAGUES HAVE NO TRUE MAX PF YET. The optimal-lineup engine reads Sleeper weekly player
 * scores; nothing computes it from native weekly scores. Native teams get `maxPf: null`, so the
 * engine falls back to points for and says so in its warnings rather than calling points for
 * "Max PF" — the mislabel `lib/league/rookieDraftOrder.ts` ships today.
 */

import { prisma } from '@/lib/prisma'
import { readMaxPfFreezeStatus } from '@/lib/commissioner-os/efl/maxPfReads'
import { storedBracketGames } from '@/lib/league-import/sleeper/bracketPlacements'
import { buildRosterIdResolver } from '@/lib/league/league-settings-draft-sync'
import { isNativePlatform } from '@/lib/dashboard/platform-label'
import { REDRAFT_SEASON_STATUS } from '@/lib/redraft/seasonStatus'
import type { RookieOrderInput, RookieOrderTeam } from './rookieOrderEngine'
import { playoffGamesFromRedraftMatchups, playoffGamesFromSleeperBracket } from './playoffGameAdapters'

export type LoadedRookieOrderInput = {
  source: 'native' | 'imported'
  /** The season the results are FROM. The order is for `season + 1`. */
  season: number
  input: Omit<RookieOrderInput, 'config'>
  rosterIdForTeam: Map<string, string | null>
  notes: string[]
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export async function loadRookieOrderInput(leagueId: string): Promise<LoadedRookieOrderInput | null> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, season: true, platform: true, platformLeagueId: true, playoffStartWeek: true, settings: true },
  })
  if (!league) return null

  return isNativePlatform(league.platform) ? loadNative(league.id) : loadImported(league)
}

const SEASON_OVER: readonly string[] = [
  REDRAFT_SEASON_STATUS.REGULAR_SEASON_COMPLETE,
  REDRAFT_SEASON_STATUS.PLAYOFFS,
  REDRAFT_SEASON_STATUS.COMPLETE,
]

async function loadNative(leagueId: string): Promise<LoadedRookieOrderInput | null> {
  // The most recent season that has started. After rollover the new season sits in `setup`, and
  // the order it needs comes from the season before it.
  const redraftSeason = await prisma.redraftSeason.findFirst({
    where: { leagueId, status: { not: REDRAFT_SEASON_STATUS.SETUP } },
    orderBy: { season: 'desc' },
    select: { id: true, season: true, currentWeek: true, playoffStartWeek: true, status: true },
  })
  if (!redraftSeason) return null
  const season = redraftSeason.season

  const [rosters, seeds, rounds] = await Promise.all([
    prisma.redraftRoster.findMany({
      where: { seasonId: redraftSeason.id },
      select: { id: true, teamName: true, ownerName: true, wins: true, losses: true, ties: true, pointsFor: true, playoffSeed: true },
    }),
    prisma.redraftPlayoffSeed.findMany({ where: { seasonId: redraftSeason.id }, select: { rosterId: true, seed: true } }),
    prisma.redraftPlayoffRound.findMany({
      where: { seasonId: redraftSeason.id },
      select: {
        roundNumber: true,
        matchups: { select: { homeRosterId: true, awayRosterId: true, winnerRosterId: true, metadata: true } },
      },
    }),
  ])
  if (rosters.length === 0) return null

  const seedByRoster = new Map(seeds.map((s) => [s.rosterId, s.seed]))
  const teams: RookieOrderTeam[] = rosters.map((r) => ({
    teamId: r.id,
    name: r.teamName || r.ownerName,
    wins: r.wins,
    losses: r.losses,
    ties: r.ties,
    pointsFor: r.pointsFor,
    maxPf: null,
    playoffSeed: seedByRoster.get(r.id) ?? r.playoffSeed ?? null,
  }))

  const playoffGames = playoffGamesFromRedraftMatchups(
    rounds.flatMap((round) => round.matchups.map((m) => ({ ...m, roundNumber: round.roundNumber }))),
  )

  // Seeds are written when the bracket is generated, which is when the regular season is over.
  const regularSeasonComplete = seeds.length > 0 || SEASON_OVER.includes(redraftSeason.status)

  const linked = await prisma.roster.findMany({
    where: { redraftRosterId: { in: rosters.map((r) => r.id) } },
    select: { id: true, redraftRosterId: true },
  })
  const rosterByRedraft = new Map(linked.map((r) => [r.redraftRosterId as string, r.id]))

  return {
    source: 'native',
    season,
    input: { teams, regularSeasonComplete, playoffGames },
    rosterIdForTeam: new Map(rosters.map((r) => [r.id, rosterByRedraft.get(r.id) ?? null])),
    notes: ['True Max PF is not computed for leagues that play on AllFantasy yet; points for is used.'],
  }
}

async function loadImported(league: {
  id: string
  season: number
  platformLeagueId: string
  playoffStartWeek: number | null
  settings: unknown
}): Promise<LoadedRookieOrderInput | null> {
  const [teamRows, rosters, dynastySeason] = await Promise.all([
    prisma.leagueTeam.findMany({
      // Same team set the Max PF reader uses, so every team can be matched to a Max PF row.
      where: { leagueId: league.id, isOrphan: false },
      select: {
        id: true, externalId: true, teamName: true, ownerName: true, wins: true, losses: true, ties: true,
        pointsFor: true, claimedByUserId: true, platformUserId: true,
      },
    }),
    prisma.roster.findMany({ where: { leagueId: league.id }, select: { id: true, platformUserId: true } }),
    prisma.leagueDynastySeason.findUnique({
      where: { uniq_league_dynasty_season_league_season: { leagueId: league.id, season: league.season } },
      select: { metadata: true },
    }),
  ])
  if (teamRows.length === 0) return null

  const notes: string[] = []
  const season = league.season
  const teamByExternal = new Map(teamRows.map((t) => [t.externalId, t.id]))
  const bracket = storedBracketGames(asRecord(dynastySeason?.metadata).playoffStructure)
  const playoffGames = playoffGamesFromSleeperBracket(bracket, (rosterId) => teamByExternal.get(String(rosterId)) ?? null)

  // Playoff teams are the teams in the winners bracket. Sleeper does not store seeds there, so
  // they are re-derived the way Sleeper's default seeding does it: record, then points for.
  const inBracket = new Set(playoffGames.flatMap((g) => [g.teamA, g.teamB]).filter((t): t is string => t != null))
  const seedOrder = teamRows
    .filter((t) => inBracket.has(t.id))
    .sort((a, b) => b.wins - a.wins || (b.pointsFor ?? 0) - (a.pointsFor ?? 0))
  const seedByTeam = new Map(seedOrder.map((t, i) => [t.id, i + 1]))
  if (inBracket.size > 0) notes.push('Seeds are re-derived from record, then points for (Sleeper default seeding).')

  const settings = asRecord(league.settings)
  const startWeek = Number(settings.playoff_week_start ?? league.playoffStartWeek)
  const finalWeek = Number.isFinite(startWeek) && startWeek > 1 ? startWeek - 1 : null
  const maxPfByTeam = new Map<string, number>()
  if (finalWeek != null) {
    const status = await readMaxPfFreezeStatus({ leagueId: league.id, season, regularSeasonFinalWeek: finalWeek })
    for (const row of status.snapshot?.rows ?? []) {
      if (row.weeksCounted > 0) maxPfByTeam.set(row.teamId, row.value)
    }
    if (status.state === 'ready') notes.push('Max PF is computed live and is not frozen yet; stat corrections can still move it.')
  } else {
    notes.push('The playoff start week is unknown, so Max PF could not be computed.')
  }

  const teams: RookieOrderTeam[] = teamRows.map((t) => ({
    teamId: t.id,
    name: t.teamName || t.ownerName,
    wins: t.wins,
    losses: t.losses,
    ties: t.ties,
    pointsFor: t.pointsFor ?? 0,
    maxPf: maxPfByTeam.get(t.id) ?? null,
    playoffSeed: seedByTeam.get(t.id) ?? null,
  }))

  const resolveRosterId = buildRosterIdResolver(rosters, teamRows)
  return {
    source: 'imported',
    season,
    input: { teams, regularSeasonComplete: inBracket.size > 0, playoffGames },
    rosterIdForTeam: new Map(teamRows.map((t) => [t.id, resolveRosterId(t.id)])),
    notes,
  }
}
