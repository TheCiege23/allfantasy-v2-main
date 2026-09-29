import 'server-only'

import { prisma } from '@/lib/prisma'
import { readInjuryClaims } from './injuryClaims'
import type { SectionState } from './leagueHome'
import { asHeadshotUrl } from './playerIdentityCompose'
import { readiness, type MoveTone } from './playerMoves'
import { countShares, type RosterForShares } from './playerSharesRank'
import { applyBridge, loadBridgedLeagues } from './bridgedRosterIds'
import { collectRosterIds, loadEspnToSleeperMap, rosterIdSpaceOf } from './rosterIdSpace'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'
import { resolveByeWeekMap } from './byeWeekMap'
import { resolveStatedWeek } from './currentWeek'
import { buildTeamSplit, type SplitStarter, type TeamSplit } from './teamSplit'

/**
 * "Your shares" — the Player Finder home's second list (Phase 2, 2026-09-27): the players you roster
 * most across your leagues, most-held first, with where they start and whether they are hurt. The
 * multi-league manager's own board — the dynastyplanet idea, with injuries on it.
 *
 * WHY NOT THE PORTFOLIO BUILDER. `buildPortfolioInsights` answers more (values, byes, per-league
 * facts) by reading EVERY roster in every claimed league and rebuilding on a cold cache. This list
 * needs only YOUR rosters, so it is four bounded reads on the finder's own joins, like the game-day
 * list beside it.
 *
 * ⚠ ONLY SLEEPER-ID ROSTERS ARE READ AS THEY ARE (same stance as gameDayTriageLoader.ts). ESPN ids
 * are translated through PlayerIdentityMap and an UNLINKED id is dropped — read raw it would be
 * counted as whoever holds that Sleeper number. Yahoo / MFL / Fantrax / Fleaflicker ids have no link
 * yet, so those leagues are counted as unreadable, never read.
 *
 * Best-ball leagues ARE counted: a share is a share, whoever sets the lineup.
 */

const MAX_LEAGUES = 250
export const SHARES_LIMIT = 20

export type ShareRow = {
  player: { sport: string; externalId: string; sleeperId: string; name: string; position: string | null; team: string | null; imageUrl: string | null }
  leagues: number
  starts: number
  ir: number
  leagueIds: string[]
  status: { label: string; tone: MoveTone } | null
  description: string | null
}

export type PlayerShares = {
  rows: ShareRow[]
  /** Leagues whose roster of yours was read. The share bar's denominator. */
  leaguesRead: number
  /** Distinct players across those rosters. */
  playersHeld: number
  /** Leagues on a platform whose player ids we cannot translate yet. */
  unsupportedLeagues: number
  /** The clubs your starting slots belong to, and the worst bye ahead (teamSplit.ts). Null when nobody starts. */
  teamSplit: TeamSplit | null
}

export async function loadPlayerShares(
  userId: string | null | undefined,
  leagueIds: string[],
  opts: { limit?: number } = {},
): Promise<SectionState<PlayerShares>> {
  if (!userId) return { available: false, reason: 'sign in to see the players you roster most' }
  const ids = leagueIds.slice(0, MAX_LEAGUES)
  if (ids.length === 0) return { available: false, reason: 'connect a league to see your shares' }
  const limit = opts.limit ?? SHARES_LIMIT

  const teams = await prisma.leagueTeam
    .findMany({ where: { claimedByUserId: userId, leagueId: { in: ids } }, select: { leagueId: true, platformUserId: true, externalId: true } })
    .catch(() => [] as Array<{ leagueId: string; platformUserId: string | null; externalId: string }>)
  const candidatesByLeague = new Map<string, Set<string>>()
  for (const t of teams) {
    const set = candidatesByLeague.get(t.leagueId) ?? new Set<string>()
    for (const c of [t.platformUserId, t.externalId, userId]) if (c) set.add(c)
    candidatesByLeague.set(t.leagueId, set)
  }
  const claimed = [...candidatesByLeague.keys()]
  if (claimed.length === 0) return { available: false, reason: 'none of your leagues has a claimed team yet' }
  const candidates = [...new Set([...candidatesByLeague.values()].flatMap((s) => [...s]))]

  const [leagues, rawRosters] = await Promise.all([
    prisma.league
      .findMany({ where: { id: { in: claimed } }, select: { id: true, platform: true, season: true, settings: true } })
      .catch(() => [] as Array<{ id: string; platform: string | null; season: number | null; settings: unknown }>),
    prisma.roster
      .findMany({ where: { leagueId: { in: claimed }, platformUserId: { in: candidates } }, select: { leagueId: true, platformUserId: true, playerData: true } })
      .catch(() => [] as Array<{ leagueId: string; platformUserId: string | null; playerData: unknown }>),
  ])
  const platformOf = new Map(leagues.map((l) => [l.id, l.platform]))
  // Fleaflicker / MFL read through the identity bridge when most of the league translates (bridgedRosterIds.ts);
  // an unbridged id is dropped, never read raw. Everything else in another id space stays unsupported.
  const bridged = await loadBridgedLeagues(leagues.filter((l) => rosterIdSpaceOf(l.platform) === 'other'))
  const bridgeMap = (leagueId: string) => (bridged.get(leagueId)?.readable ? bridged.get(leagueId)!.map : null)
  const unsupported = new Set(leagues.filter((l) => rosterIdSpaceOf(l.platform) === 'other' && !bridgeMap(l.id)).map((l) => l.id))

  // Yours only: the roster whose platformUserId is one of THIS league's candidate ids, one per league.
  const mine = new Map<string, Record<string, unknown>>()
  for (const r of rawRosters) {
    if (mine.has(r.leagueId) || unsupported.has(r.leagueId)) continue
    if (!r.platformUserId || !candidatesByLeague.get(r.leagueId)?.has(r.platformUserId)) continue
    const map = bridgeMap(r.leagueId)
    mine.set(r.leagueId, map ? applyBridge(r.playerData, map) : ((r.playerData ?? {}) as Record<string, unknown>))
  }
  const espnLeagues = [...mine.keys()].filter((id) => rosterIdSpaceOf(platformOf.get(id)) === 'espn')
  const espnMap = await loadEspnToSleeperMap(collectRosterIds(espnLeagues.map((id) => mine.get(id))))

  const list = (pd: Record<string, unknown>, key: string, espn: boolean): string[] => {
    const arr = Array.isArray(pd[key]) ? (pd[key] as unknown[]) : []
    const ids = arr.map((x) => (x == null ? '' : String(x))).filter((x) => x && x !== '0')
    return espn ? ids.map((id) => espnMap.get(id) ?? '').filter(Boolean) : ids
  }
  const rosters: RosterForShares[] = [...mine.entries()].map(([leagueId, pd]) => {
    const espn = rosterIdSpaceOf(platformOf.get(leagueId)) === 'espn'
    return { leagueId, starters: list(pd, 'starters', espn), reserve: list(pd, 'reserve', espn), taxi: list(pd, 'taxi', espn), players: list(pd, 'players', espn) }
  })
  const counts = countShares(rosters)
  const teamSplit = await loadTeamSplit(counts, leagues.filter((l) => mine.has(l.id))).catch(() => null)
  const base = { leaguesRead: rosters.length, playersHeld: counts.length, unsupportedLeagues: unsupported.size, teamSplit }
  if (counts.length === 0) return { available: true, data: { rows: [], ...base } }

  // Enrich a margin past the limit: a catalog miss drops a row, and the list should still be full.
  const top = counts.slice(0, limit + 10)
  const players = await prisma.sportsPlayer
    .findMany({
      where: { sleeperId: { in: top.map((c) => c.sleeperId) } },
      select: { sleeperId: true, sport: true, externalId: true, name: true, position: true, team: true, imageUrl: true },
    })
    .catch(() => [] as Array<{ sleeperId: string | null; sport: string; externalId: string; name: string; position: string | null; team: string | null; imageUrl: string | null }>)
  const bySleeper = new Map<string, (typeof players)[number]>()
  for (const p of players) {
    if (!p.sleeperId) continue
    const cur = bySleeper.get(p.sleeperId)
    if (!cur || (!cur.imageUrl && p.imageUrl)) bySleeper.set(p.sleeperId, p)
  }
  const resolved = top.filter((c) => bySleeper.has(c.sleeperId)).slice(0, limit)
  const sport = bySleeper.get(resolved[0]?.sleeperId ?? '')?.sport ?? 'NFL'
  const injuries = await readInjuryClaims(sport, resolved.map((c) => bySleeper.get(c.sleeperId)!))

  const rows: ShareRow[] = resolved.map((c) => {
    const p = bySleeper.get(c.sleeperId)!
    const inj = injuries.get(p.name.trim().toLowerCase()) ?? null
    const ready = readiness(inj?.status ?? null, Boolean(inj))
    return {
      player: { sport: p.sport, externalId: p.externalId, sleeperId: c.sleeperId, name: p.name, position: p.position, team: p.team, imageUrl: asHeadshotUrl(p.imageUrl) },
      leagues: c.leagues,
      starts: c.starts,
      ir: c.ir,
      leagueIds: c.leagueIds,
      // A healthy player carries no chip: the list flags, it does not reassure.
      status: ready && ready.tone !== 'good' ? ready : null,
      description: inj?.description ?? null,
    }
  })
  rows.sort((a, b) => b.leagues - a.leagues || b.starts - a.starts || a.player.name.localeCompare(b.player.name))
  return { available: true, data: { rows, ...base } }
}

/**
 * The club split over EVERY starter you have, not just the listed top shares — the same counts, one
 * catalog read for their clubs. The week comes from your leagues' own stated week (resolveStatedWeek)
 * and the byes from the schedule (resolveByeWeekMap, the one bye rule); either unreadable and the
 * split still shows, without a bye call.
 */
async function loadTeamSplit(
  counts: ReadonlyArray<{ sleeperId: string; starts: number }>,
  leagues: ReadonlyArray<{ season: number | null; settings: unknown }>,
): Promise<TeamSplit | null> {
  const starting = counts.filter((c) => c.starts > 0)
  if (starting.length === 0) return null
  const stated = resolveStatedWeek([...leagues])
  const [catalog, byes] = await Promise.all([
    prisma.sportsPlayer
      .findMany({ where: { sleeperId: { in: starting.map((c) => c.sleeperId) } }, select: { sleeperId: true, name: true, position: true, team: true } })
      .catch(() => [] as Array<{ sleeperId: string | null; name: string; position: string | null; team: string | null }>),
    stated ? resolveByeWeekMap(stated.seasonYear).catch(() => null) : Promise.resolve(null),
  ])
  // A player can have a row per provider; keep the one that knows his club.
  const bySleeper = new Map<string, (typeof catalog)[number]>()
  for (const r of catalog) {
    if (!r.sleeperId) continue
    const cur = bySleeper.get(r.sleeperId)
    if (!cur || (!cur.team && r.team) || (!cur.position && r.position)) bySleeper.set(r.sleeperId, r)
  }
  const starters: SplitStarter[] = starting.map((c) => {
    const p = bySleeper.get(c.sleeperId)
    return { sleeperId: c.sleeperId, name: p?.name ?? c.sleeperId, team: p?.team ?? null, position: p?.position ?? null, starts: c.starts }
  })
  return buildTeamSplit({ starters, byes, currentWeek: stated?.week ?? null, fold: (t) => normalizeTeamAbbrev(t) })
}
