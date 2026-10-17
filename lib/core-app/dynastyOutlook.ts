import 'server-only'

import { prisma } from '@/lib/prisma'
import { loadTeamFuturePicks, type FuturePickCoverage } from '@/lib/league-trade-engine/importedFuturePicks'
import { isNativeFuturePickLeague, loadNativeFuturePicks } from '@/lib/league-trade-engine/nativeFuturePicks'
import { roundOrdinal } from '@/lib/league-trade-engine/futurePickInventory'

/**
 * My Team's dynasty view: the draft capital you hold, and how old the lineup you are starting is.
 *
 * WHY. A dynasty manager's roster page answered only "this week" — the lineup, the lock, the
 * matchup. The two facts that decide a dynasty team's next three seasons were each one screen away
 * (picks in the trade picker, ages on each player card) and never together. Both are already
 * stored; this reads them, it does not model anything.
 *
 * ⚠ THE AGE LINE IS A RULE OF THUMB AND SAYS SO. `AGING_FROM` is the age at which a position's
 * production usually starts to fall in dynasty consensus — not a projection about any player. The
 * card names the threshold beside every player it lists, so it reads as a flag, never a verdict.
 */

export type DynastyPick = { season: number; round: number; label: string; fromTeamName: string | null }

export type DynastyOutlook = {
  picks:
    | { available: true; coverage: FuturePickCoverage; bySeason: Array<{ season: number; picks: DynastyPick[] }> }
    | { available: false; reason: string }
  ages:
    | {
        available: true
        /** Median age of starters whose age we hold. */
        medianStarterAge: number
        /** Starters with a known age / all starters considered. */
        known: number
        total: number
        /** Starters at or past their position's usual decline age, oldest first. */
        aging: Array<{ sleeperId: string; name: string; position: string; age: number; threshold: number }>
        /** Players 24 or younger anywhere on the roster — the core that is still rising. */
        youngCore: number
      }
    | { available: false; reason: string }
}

/** Dynasty consensus: the age a position's production usually starts to decline. */
export const AGING_FROM: Readonly<Record<string, number>> = { QB: 34, RB: 27, WR: 29, TE: 30 }

type Player = { sleeperId: string; name: string; position: string | null }

/** Pure: the age half, from ages already read. Exported for tests. */
export function summariseAges(
  starters: readonly Player[],
  roster: readonly Player[],
  ageOf: ReadonlyMap<string, number>,
): DynastyOutlook['ages'] {
  const known = starters.filter((p) => ageOf.has(p.sleeperId))
  if (known.length === 0) return { available: false, reason: 'no ages on file for your starters' }
  const ages = known.map((p) => ageOf.get(p.sleeperId)!).sort((a, b) => a - b)
  const mid = Math.floor(ages.length / 2)
  const median = ages.length % 2 ? ages[mid] : (ages[mid - 1] + ages[mid]) / 2
  const aging = known
    .map((p) => {
      const pos = String(p.position ?? '').toUpperCase()
      const threshold = AGING_FROM[pos]
      const age = ageOf.get(p.sleeperId)!
      return threshold != null && age >= threshold ? { sleeperId: p.sleeperId, name: p.name, position: pos, age, threshold } : null
    })
    .filter((x): x is NonNullable<typeof x> => x != null)
    .sort((a, b) => b.age - a.age || a.name.localeCompare(b.name))
  const youngCore = roster.filter((p) => (ageOf.get(p.sleeperId) ?? 99) <= 24).length
  return { available: true, medianStarterAge: Math.round(median * 10) / 10, known: known.length, total: starters.length, aging, youngCore }
}

/** Pure: group a team's picks by draft. Exported for tests. */
export function groupPicks(picks: ReadonlyArray<{ season: number; round: number; fromTeamName: string | null }>): Array<{ season: number; picks: DynastyPick[] }> {
  const by = new Map<number, DynastyPick[]>()
  for (const p of [...picks].sort((a, b) => a.season - b.season || a.round - b.round)) {
    const list = by.get(p.season) ?? []
    list.push({ season: p.season, round: p.round, label: roundOrdinal(p.round), fromTeamName: p.fromTeamName })
    by.set(p.season, list)
  }
  return [...by].map(([season, list]) => ({ season, picks: list }))
}

export async function loadDynastyOutlook(args: {
  league: {
    id: string
    platform: string | null
    leagueType: string | null
    isDynasty: boolean | null
    season: number | null
    status: string | null
  }
  /** Your team's provider id (`LeagueTeam.externalId`). */
  teamExternalId: string | null
  /** The ids `Roster.platformUserId` may hold for you — see `myRosterCandidates`. */
  rosterCandidates: readonly string[]
  starters: readonly Player[]
  roster: readonly Player[]
}): Promise<DynastyOutlook> {
  const ids = [...new Set([...args.starters, ...args.roster].map((p) => p.sleeperId))]
  const [ageRows, picks] = await Promise.all([
    ids.length
      ? prisma.sportsPlayer
          .findMany({ where: { sleeperId: { in: ids }, age: { not: null } }, select: { sleeperId: true, age: true }, orderBy: { updatedAt: 'desc' } })
          .catch(() => [] as Array<{ sleeperId: string | null; age: number | null }>)
      : Promise.resolve([] as Array<{ sleeperId: string | null; age: number | null }>),
    readPicks(args),
  ])
  // Newest row per id wins (several vendor rows can carry the same Sleeper id).
  const ageOf = new Map<string, number>()
  for (const r of ageRows) if (r.sleeperId && r.age != null && !ageOf.has(r.sleeperId)) ageOf.set(r.sleeperId, r.age)
  return { picks, ages: summariseAges(args.starters, args.roster, ageOf) }
}

async function readPicks(args: Parameters<typeof loadDynastyOutlook>[0]): Promise<DynastyOutlook['picks']> {
  const { league } = args
  if (isNativeFuturePickLeague({ platform: league.platform, leagueType: league.leagueType, isDynasty: league.isDynasty })) {
    const [native, mine] = await Promise.all([
      loadNativeFuturePicks(league.id).catch(() => null),
      args.rosterCandidates.length
        ? prisma.roster.findFirst({ where: { leagueId: league.id, platformUserId: { in: [...args.rosterCandidates] } }, select: { id: true } }).catch(() => null)
        : Promise.resolve(null),
    ])
    if (!native) return { available: false, reason: 'this league has no future-pick inventory yet' }
    if (!mine) return { available: false, reason: 'we could not tell which roster in this league is yours' }
    const own = native.picks.filter((p) => p.ownerTeamId === mine.id)
    return { available: true, coverage: 'complete', bySeason: groupPicks(own.map((p) => ({ ...p, fromTeamName: p.originalTeamId === p.ownerTeamId ? null : 'another team' }))) }
  }
  if (!args.teamExternalId) return { available: false, reason: 'your team in this league has no provider id on file' }
  const teams = await prisma.leagueTeam
    .findMany({
      where: { leagueId: league.id },
      select: { id: true, externalId: true, platformUserId: true, claimedByUserId: true, teamName: true },
    })
    .catch(() => null)
  if (!teams) return { available: false, reason: 'the league’s teams could not be read' }
  const out = await loadTeamFuturePicks({
    leagueId: league.id,
    platform: league.platform,
    isDynasty: Boolean(league.isDynasty),
    leagueSeason: league.season,
    status: league.status,
    teams: teams.map((t) => ({ ...t, externalId: String(t.externalId ?? '') })),
    teamExternalId: args.teamExternalId,
  })
  if (out.readFailed) return { available: false, reason: 'the pick table could not be read' }
  if (out.coverage === 'none') return { available: false, reason: 'future picks are not synced for this platform yet' }
  return { available: true, coverage: out.coverage, bySeason: groupPicks(out.picks) }
}
