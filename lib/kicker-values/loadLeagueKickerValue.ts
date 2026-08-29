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
 *
 * ⚠ AND AF-NATIVE LEAGUES USE NEITHER — THEY STORE A SLOT MAP, NOT A POSITION ARRAY.
 * Measured on production 2026-08-29: of 115 leagues, 42 matched no array spelling. 18 were
 * `allfantasy_test_adp_seed` rows with null settings, but the other 24 (23 `manual`, 1
 * `native`) were real leagues carrying their rulebook at
 * `settings.roster.config.sections[].slots` as `{ K: 1, QB: 1, RB: 2, BN: 6, ... }`.
 *
 * Fourteen of those twenty-four hold an explicit `K`. `TheCiege24's 12-Team NFL Redraft
 * League` says `"K":1` outright — it starts a kicker, and before this it got `null` and
 * rendered no panel at all. The failure was silent and in the safe direction, which is
 * exactly why it survived: "no kicker value" is indistinguishable from "no kicker here".
 *
 * ⚠ COUNTS MATTER, SO THE MAP IS EXPANDED RATHER THAN KEY-LISTED. `{ K: 2 }` is a
 * two-kicker league, and replacement level is `slots * teams + 1` — flattening it to one `K`
 * would price a 14-team two-kicker league at K15 instead of K29. Bench and IR ride along
 * untouched: they are not `K`, so `countKickerSlots` ignores them, and inventing a
 * starter/bench distinction here would be a second opinion on a question the array spellings
 * never answered either.
 */
function extractRosterPositions(settings: unknown): string[] | null {
  const s = (settings ?? {}) as Record<string, unknown>
  const raw = (s.roster_positions ?? s.rosterPositions ?? null) as unknown
  if (Array.isArray(raw)) return raw.map((x) => String(x).toUpperCase())

  const sections = (s.roster as Record<string, unknown> | undefined)?.config as
    | Record<string, unknown>
    | undefined
  const list = sections?.sections
  if (!Array.isArray(list)) return null

  /*
   * Every section, not just the first. A league may split its rulebook across more than one,
   * and a kicker slot in the second would otherwise read as no kicker at all.
   */
  const out: string[] = []
  for (const section of list) {
    const slots = (section as Record<string, unknown> | null)?.slots
    if (!slots || typeof slots !== 'object') continue
    for (const [pos, count] of Object.entries(slots as Record<string, unknown>)) {
      const n = Number(count)
      if (!Number.isFinite(n) || n <= 0) continue
      for (let i = 0; i < Math.min(n, 64); i++) out.push(pos.toUpperCase())
    }
  }
  // Null, not `[]`, when nothing parsed — `[]` would assert "this league starts nothing".
  return out.length > 0 ? out : null
}

/**
 * The team count a league DECLARES, as the fallback when its roster rows are missing.
 *
 * Two independent fields, checked in the order they proved reliable on production: the column
 * first, then the native settings blob. Anything at or below 1 is rejected as a non-answer
 * rather than trusted — a one-team league does not exist, and treating it as one is precisely
 * the bug this guards.
 */
function declaredTeamCount(leagueSize: unknown, settings: unknown): number | null {
  const s = (settings ?? {}) as Record<string, unknown>
  const nested = (s.roster as Record<string, unknown> | undefined)?.config as
    | Record<string, unknown>
    | undefined
  for (const candidate of [leagueSize, s.default_team_count, nested?.teamCount]) {
    const n = Number(candidate)
    if (Number.isFinite(n) && n > 1) return Math.floor(n)
  }
  return null
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
        select: { id: true, settings: true, leagueType: true, isDynasty: true, leagueSize: true },
      })
      .catch(() => null)) ??
    (await args.prisma.league
      .findFirst({
        where: { platformLeagueId: args.leagueId },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, settings: true, leagueType: true, isDynasty: true, leagueSize: true },
      })
      .catch(() => null))

  if (!league) return null

  /*
   * Team count from the roster rows rather than a settings field: `leagueSize` is frequently
   * null on imported leagues, and a wrong team count moves replacement level, which is the one
   * input that actually varies between leagues here.
   *
   * ⚠ BUT THE RULE INVERTS ON AF-NATIVE LEAGUES, AND TAKING ROSTER ROWS ALONE PRICES THEM
   * WRONG. Measured on production 2026-08-29 across the 24 native/manual leagues: `leagueSize`
   * and `settings.default_team_count` agree and are populated on all but one (12/12, 14/14,
   * 8/8), while `roster.count()` is 0 on ten of them and 1 on two more — rosters simply were
   * never created. `TheCiege24's 12-Team NFL Redraft League` counted ONE roster row, which put
   * replacement at K2 instead of K13 and priced a kicker at 133 instead of 287.
   *
   * A count of 0 or 1 is not a one-team league, it is a missing answer. So roster rows still
   * win wherever they are real, and the declared size is the fallback rather than the source —
   * which leaves every imported league on exactly the path it was already on.
   */
  const rosterCount = await args.prisma.roster
    .count({ where: { leagueId: league.id } })
    .catch(() => 0)

  const declared = declaredTeamCount(league.leagueSize, league.settings)
  const numTeams = rosterCount > 1 ? rosterCount : declared

  /*
   * ⚠ NULL RATHER THAN A GUESS. With no roster rows and no declared size there is nothing to
   * put replacement level on, and defaulting to 12 would state a specific price for a league
   * we cannot measure. The panel renders nothing, which is the same thing it did before this
   * league was reachable at all — the honest outcome, not a regression.
   */
  if (numTeams === null) return null

  return resolveLeagueKickerValue({
    rosterPositions: extractRosterPositions(league.settings),
    numTeams,
    isDynasty:
      league.isDynasty ?? (league.leagueType ?? '').toLowerCase().includes('dynasty'),
  })
}
