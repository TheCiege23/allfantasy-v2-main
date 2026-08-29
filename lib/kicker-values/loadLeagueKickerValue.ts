/**
 * The kicker value for one league, read from the database.
 *
 * The thin DB half of `lib/kicker-values/leagueKickerValue.ts`, which is pure and stays that
 * way. Everything here does is resolve the two league facts the pure function needs — how many
 * kicker slots the rulebook demands and how many teams are in it — and hand them over.
 *
 * ⚠ DELIBERATELY NOT GATED ON IDP SCORING, WHICH IS THE ENTIRE REASON IT EXISTS SEPARATELY
 * FROM `defenseHub.ts`. The Defense Hub answers only for leagues that roster defenders, and
 * measured on production that is 10 of 115 leagues — of which just 5 also start a kicker.
 * NINETEEN leagues start a kicker. Reading the kicker value through the hub would leave the
 * other fourteen with no way to see it at all.
 */

import type { PrismaClient } from '@prisma/client'

import { resolveLeagueKickerValue, type LeagueKickerValue } from './leagueKickerValue'

/**
 * The league's own starting slots.
 *
 * ⚠ BOTH SPELLINGS. Sleeper writes `roster_positions`; some import paths normalise to
 * `rosterPositions`. Reading only one silently reports zero kicker slots for half the leagues,
 * which reads as "this league has no kicker" rather than as a parsing miss.
 */
function extractRosterPositions(settings: unknown): string[] | null {
  const s = (settings ?? {}) as Record<string, unknown>
  const raw = (s.roster_positions ?? s.rosterPositions ?? null) as unknown
  return Array.isArray(raw) ? raw.map((x) => String(x).toUpperCase()) : null
}

export interface LoadLeagueKickerValueArgs {
  prisma: PrismaClient
  /** Either id space — `League.id` uuid or the platform's own league id. */
  leagueId: string
}

/**
 * Resolve what a kicker is worth in this league.
 *
 * Returns null when the league cannot be found at all. A league that exists but starts no
 * kicker returns a result whose `value` is null — a meaningful answer ("not an asset here")
 * rather than an absence.
 */
export async function loadLeagueKickerValue(
  args: LoadLeagueKickerValueArgs,
): Promise<LeagueKickerValue | null> {
  const league =
    (await args.prisma.league
      .findUnique({
        where: { id: args.leagueId },
        select: { id: true, settings: true, leagueType: true, isDynasty: true },
      })
      .catch(() => null)) ??
    (await args.prisma.league
      .findFirst({
        where: { platformLeagueId: args.leagueId },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, settings: true, leagueType: true, isDynasty: true },
      })
      .catch(() => null))

  if (!league) return null

  /*
   * Team count from the roster rows rather than a settings field: `leagueSize` is frequently
   * null on imported leagues, and a wrong team count moves replacement level, which is the one
   * input that actually varies between leagues here.
   */
  const rosterCount = await args.prisma.roster
    .count({ where: { leagueId: league.id } })
    .catch(() => 0)

  return resolveLeagueKickerValue({
    rosterPositions: extractRosterPositions(league.settings),
    numTeams: Math.max(rosterCount, 1),
    isDynasty:
      league.isDynasty ?? (league.leagueType ?? '').toLowerCase().includes('dynasty'),
  })
}
