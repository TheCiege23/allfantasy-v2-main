/**
 * PromotionEngine — run promotion/relegation at season end; move teams between divisions.
 */

import { prisma } from '@/lib/prisma'
import { getStandingsWithZones } from './StandingsEvaluator'
import type { SeasonEndTransition } from './types'

export interface RunPromotionInput {
  leagueId: string
  /** If true, perform DB updates; if false, return planned transitions only */
  dryRun?: boolean
  /**
   * An ALREADY-RESOLVED plan to apply, instead of computing one from standings zones.
   *
   * 🛑 THIS ENGINE APPLIES. IT DOES NOT LEARN WHERE THE PLAN CAME FROM. Nothing here knows about
   * promotion playoffs, relegation playoffs, tier-specific exemptions or rookie draft rules — those
   * are competition policy and live in `lib/commissioner-os/efl/seasonTransitionResolver.ts`. The
   * split is the point: a resolver decides, this engine mutates, and neither grows the other's job.
   *
   * ⚠ OMIT IT AND BEHAVIOUR IS UNCHANGED. Every existing caller passes `{ leagueId, dryRun }` and
   * takes exactly the standings-zone path it always did — same queries, same rules, same output.
   * This is an additive parameter, not a rewrite.
   */
  transitions?: readonly SeasonEndTransition[]
}

export interface RunPromotionResult {
  leagueId: string
  applied: boolean
  transitions: SeasonEndTransition[]
  error?: string
  /**
   * How the transitions were arrived at.
   *
   * ⚠ REPORTED SO A CALLER CANNOT MISTAKE ONE FOR THE OTHER. `'standings_zones'` is this engine's
   * own computation; `'supplied'` means a resolver decided and the engine only moved rows. An audit
   * that cannot tell those apart cannot answer "who decided this team goes down".
   */
  source?: 'standings_zones' | 'supplied'
  /** Why a supplied plan was refused. Present only when `applied` is false and a plan was given. */
  rejected?: string[]
}

/**
 * Validate a supplied plan before any row is touched.
 *
 * 🛑 VALIDATION HAPPENS BEFORE THE FIRST WRITE, NOT DURING. `leagueTeam.update` is last-write-wins
 * and each row commits independently, so a plan that turns out to be contradictory halfway through
 * leaves the ladder in a state no resolver ever intended. Everything is checked first, and one
 * failure refuses the whole plan.
 */
async function validateSuppliedTransitions(
  leagueId: string,
  transitions: readonly SeasonEndTransition[],
): Promise<string[]> {
  const rejected: string[] = []
  if (transitions.length === 0) return rejected

  const [teams, divisions] = await Promise.all([
    prisma.leagueTeam.findMany({ where: { leagueId }, select: { id: true } }),
    prisma.leagueDivision.findMany({ where: { leagueId }, select: { id: true, tierLevel: true } }),
  ])
  const teamIds = new Set(teams.map((t) => t.id))
  const divisionTier = new Map(divisions.map((d) => [d.id, d.tierLevel]))

  const seenTeams = new Set<string>()
  for (const t of transitions) {
    /*
     * ⚠ EVERY ID IS CHECKED AGAINST THIS LEAGUE. A resolver handed the wrong league's standings
     * would otherwise move another league's teams into this one's divisions — a cross-tenant write
     * with no error, which is the worst shape of bug this table can produce.
     */
    if (!teamIds.has(t.teamId)) {
      rejected.push(`${t.teamName || t.teamId} is not a team in this league.`)
    }
    if (!divisionTier.has(t.fromDivisionId)) {
      rejected.push(`fromDivisionId ${t.fromDivisionId} is not a division in this league.`)
    }
    if (!divisionTier.has(t.toDivisionId)) {
      rejected.push(`toDivisionId ${t.toDivisionId} is not a division in this league.`)
    }
    if (t.fromDivisionId === t.toDivisionId) {
      rejected.push(`${t.teamName || t.teamId} would move to the division it is already in.`)
    }
    if (seenTeams.has(t.teamId)) {
      rejected.push(`${t.teamName || t.teamId} appears in the plan more than once.`)
    }
    seenTeams.add(t.teamId)

    /*
     * ⚠ DIRECTION IS CHECKED AGAINST THE ACTUAL TIER LEVELS, NOT TRUSTED FROM THE PLAN. Tier 1 is
     * the HIGHEST, so a promotion must DECREASE the tier level. A resolver with the orientation
     * inverted would otherwise relegate its champions and the engine would apply it faithfully.
     */
    const fromTier = divisionTier.get(t.fromDivisionId)
    const toTier = divisionTier.get(t.toDivisionId)
    if (fromTier !== undefined && toTier !== undefined) {
      if (t.type === 'promotion' && toTier >= fromTier) {
        rejected.push(`${t.teamName || t.teamId}: a promotion must move to a higher tier (lower tierLevel).`)
      }
      if (t.type === 'relegation' && toTier <= fromTier) {
        rejected.push(`${t.teamName || t.teamId}: a relegation must move to a lower tier (higher tierLevel).`)
      }
    }
  }
  return rejected
}

/**
 * For each promotion rule: take top promoteCount from toTierLevel (lower tier) → move to fromTierLevel;
 * take bottom relegateCount from fromTierLevel → move to toTierLevel.
 * Tiers: fromTierLevel is the higher (e.g. 1), toTierLevel is the lower (e.g. 2).
 */
export async function runPromotionRelegation(
  input: RunPromotionInput
): Promise<RunPromotionResult> {
  const { leagueId, dryRun = false } = input
  const transitions: SeasonEndTransition[] = []

  /*
   * 🛑 THE SUPPLIED-PLAN PATH RETURNS BEFORE THE STANDINGS-ZONE PATH IS EVEN REACHED, so the
   * original code below runs byte-for-byte as it always has whenever `transitions` is omitted.
   */
  if (input.transitions) {
    const supplied = [...input.transitions]
    try {
      const rejected = await validateSuppliedTransitions(leagueId, supplied)
      if (rejected.length > 0) {
        return { leagueId, applied: false, transitions: [], source: 'supplied', rejected }
      }
      if (dryRun || supplied.length === 0) {
        return { leagueId, applied: false, transitions: supplied, source: 'supplied' }
      }
      /*
       * ⚠ A TRANSACTION HERE, AND DELIBERATELY NOT ON THE PATH BELOW. A resolved ladder is
       * all-or-nothing: applying half of it moves some teams and strands others in a tier that no
       * longer has room. The standings-zone path is left exactly as it was — adding a transaction
       * there would be a behaviour change to existing callers, which this parameter exists to avoid.
       */
      await prisma.$transaction(
        supplied.map((t) =>
          prisma.leagueTeam.update({ where: { id: t.teamId }, data: { divisionId: t.toDivisionId } }),
        ),
      )
      return { leagueId, applied: true, transitions: supplied, source: 'supplied' }
    } catch (e) {
      return {
        leagueId,
        applied: false,
        transitions: [],
        source: 'supplied',
        error: e instanceof Error ? e.message : 'Supplied promotion plan failed',
      }
    }
  }

  try {
    const rules = await prisma.promotionRule.findMany({
      where: { leagueId },
      orderBy: [{ fromTierLevel: 'asc' }, { toTierLevel: 'asc' }],
    })

    const divisions = await prisma.leagueDivision.findMany({
      where: { leagueId },
      orderBy: { tierLevel: 'asc' },
    })
    const divisionByTier = new Map(divisions.map((d) => [d.tierLevel, d]))

    for (const rule of rules) {
      const higherDivision = divisionByTier.get(rule.fromTierLevel)
      const lowerDivision = divisionByTier.get(rule.toTierLevel)
      if (!higherDivision || !lowerDivision) continue

      const higherStandings = await getStandingsWithZones({
        divisionId: higherDivision.id,
        promoteCount: 0,
        relegateCount: rule.relegateCount,
      })
      const lowerStandings = await getStandingsWithZones({
        divisionId: lowerDivision.id,
        promoteCount: rule.promoteCount,
        relegateCount: 0,
      })

      const toRelegate = higherStandings.filter((s) => s.inRelegationZone).slice(0, rule.relegateCount)
      const toPromote = lowerStandings.filter((s) => s.inPromotionZone).slice(0, rule.promoteCount)

      for (const t of toRelegate) {
        transitions.push({
          teamId: t.teamId,
          teamName: t.teamName,
          fromDivisionId: higherDivision.id,
          fromTierLevel: rule.fromTierLevel,
          toDivisionId: lowerDivision.id,
          toTierLevel: rule.toTierLevel,
          type: 'relegation',
        })
      }
      for (const t of toPromote) {
        transitions.push({
          teamId: t.teamId,
          teamName: t.teamName,
          fromDivisionId: lowerDivision.id,
          fromTierLevel: rule.toTierLevel,
          toDivisionId: higherDivision.id,
          toTierLevel: rule.fromTierLevel,
          type: 'promotion',
        })
      }
    }

    if (!dryRun && transitions.length > 0) {
      for (const t of transitions) {
        await prisma.leagueTeam.update({
          where: { id: t.teamId },
          data: { divisionId: t.toDivisionId },
        })
      }
    }

    return {
      leagueId,
      applied: !dryRun && transitions.length > 0,
      transitions,
      source: 'standings_zones',
    }
  } catch (e) {
    return {
      leagueId,
      applied: false,
      transitions: [],
      error: e instanceof Error ? e.message : 'Promotion run failed',
    }
  }
}
