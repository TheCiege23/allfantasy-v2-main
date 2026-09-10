/**
 * Named selectors for `LeagueTeam`, one per question a reader can ask.
 *
 * ── WHY THIS EXISTS, AND WHY IT IS NOT A RENAME OF `ACTIVE_TEAM_WHERE` ──────────────────────
 *
 * 🛑 THERE IS NO SINGLE "ACTIVE TEAM" PREDICATE, AND PRETENDING THERE WAS COST A WHOLE BATCH.
 * `ACTIVE_TEAM_WHERE = { NOT: { isOrphan: true } }` was applied to ~16 readers on the belief that
 * `isOrphan` meant "archived". It does not. Five writers set it true:
 *
 *   canonical league creation   → an OPEN, CLAIMABLE slot        (current!)
 *   GuillotineEliminationEngine → an ELIMINATED team             (current!)
 *   commissioner renewal        → an ADMINISTRATIVELY REMOVED team
 *   commissioner renewal sweep  → collapses vacant + removed + `orphan-*` into one flag
 *   Sleeper reconciliation      → ABSENT FROM THE PROVIDER'S ROSTER SET
 *
 * So a brand-new 12-team league has eleven rows with `isOrphan = true` that are current,
 * claimable franchises, and filtering them reported that league as having one team.
 *
 * ⚠ THE OLD CONSTANT IS NOT REDEFINED HERE, DELIBERATELY. Redefining a name leaves every existing
 * call site pointing at a meaning that changed underneath it — which is the failure this file
 * exists to end. `activeTeams.ts` keeps its current behaviour and is being retired call site by
 * call site; each one moves to whichever selector below states what it actually needs.
 *
 * ── THE TRANSITIONAL PROBLEM, NAMED RATHER THAN HIDDEN ──────────────────────────────────────
 *
 * Every row that predates `lifecycleState` is `UNKNOWN`, because nothing has classified it. A
 * reader that wants "current franchises" therefore has two bad options and one honest one:
 *
 *   `lifecycleState: CURRENT`              → hides every unclassified live franchise. Wrong today.
 *   treat UNKNOWN as CURRENT               → a guess, and the guess this batch was blocked for.
 *   include UNKNOWN, and SAY SO            → what the `..._INCLUDING_UNKNOWN` selectors do.
 *
 * The third is chosen. The names carry the compromise so a reader cannot forget it is there, and
 * so a later cleanup can find every site that still tolerates UNKNOWN by grepping one token.
 * **UNKNOWN is never called "current".**
 */

import type { Prisma } from '@prisma/client'

/**
 * Every franchise that is part of the league right now — INCLUDING vacant seats and AI-managed
 * seats, and including rows not yet classified.
 *
 * Use for: league size, standings denominators, draft order and pick-in-round maths, trade and
 * dynasty valuation inputs, Commissioner Hub tiles, "N of M claimed" denominators.
 *
 * ⚠ A VACANT SEAT IS ONE OF THE LEAGUE'S TEAMS. That is the whole correction. If a count would
 * change when a manager leaves an otherwise unchanged league, it probably wants this selector.
 */
export const CURRENT_FRANCHISES_INCLUDING_UNKNOWN = {
  lifecycleState: { in: ['CURRENT', 'UNKNOWN'] },
} as const satisfies Prisma.LeagueTeamWhereInput

/** Franchises positively known to have left. Never inferred from `isOrphan`. */
export const ARCHIVED_FRANCHISES = {
  lifecycleState: 'ARCHIVED',
} as const satisfies Prisma.LeagueTeamWhereInput

/**
 * Seats a person could take over right now.
 *
 * ⚠ NO `UNKNOWN` HERE, AND THAT ASYMMETRY IS THE POINT. Offering an unclassified row as claimable
 * could hand someone a departed manager's franchise; omitting a genuinely vacant one only means a
 * seat is not advertised until it is classified. The costs are not symmetric, so the selector is
 * not either.
 */
export const CLAIMABLE_FRANCHISES = {
  lifecycleState: 'CURRENT',
  managerKind: 'VACANT',
} as const satisfies Prisma.LeagueTeamWhereInput

/**
 * Franchises still in the competition — excludes guillotine/survivor eliminations.
 *
 * Elimination is NOT archival: an eliminated team stays a current franchise, stays in league
 * history, and stays resolvable by every identity map.
 */
export const ELIGIBLE_FRANCHISES_INCLUDING_UNKNOWN = {
  lifecycleState: { in: ['CURRENT', 'UNKNOWN'] },
  eliminatedAt: null,
} as const satisfies Prisma.LeagueTeamWhereInput

/**
 * Franchises run by a real person, for recipient sets — email, chat, @-mentions, notifications.
 *
 * 🛑 A RECIPIENT SET IS AN IDENTITY QUESTION, NOT AN ARCHIVAL ONE. `claimedByUserId` is the
 * identity fact; the lifecycle terms only stop a *departed* manager being contacted.
 *
 * ⚠ `managerKind` IS NOT IN THIS PREDICATE YET, AND THAT IS A KNOWN GAP. Until the writers
 * populate it every row is UNKNOWN, so requiring `HUMAN` would empty every recipient list. An
 * imported league also has real, human-run seats that nobody has claimed on AllFantasy — so
 * `claimedByUserId` under-reaches rather than over-reaches, which is the safe direction for a
 * send. Tighten to `managerKind: 'HUMAN'` once the writer census lands.
 */
export const HUMAN_RECIPIENTS_INCLUDING_UNKNOWN = {
  lifecycleState: { in: ['CURRENT', 'UNKNOWN'] },
  claimedByUserId: { not: null },
} as const satisfies Prisma.LeagueTeamWhereInput

/**
 * Rows that have never been classified. Exposed so a backfill or an audit can COUNT them —
 * an unclassified population that nobody can measure is how this state got here.
 */
export const UNCLASSIFIED_FRANCHISES = {
  lifecycleState: 'UNKNOWN',
} as const satisfies Prisma.LeagueTeamWhereInput

/** The minimum a row needs for the predicates below to judge it. */
export interface TeamLifecycleState {
  lifecycleState?: 'UNKNOWN' | 'CURRENT' | 'ARCHIVED' | null
  managerKind?: 'UNKNOWN' | 'HUMAN' | 'VACANT' | 'AI' | null
}

/**
 * In-memory counterpart of `CURRENT_FRANCHISES_INCLUDING_UNKNOWN`.
 *
 * ⚠ AN ABSENT FIELD COUNTS AS UNKNOWN, NOT AS CURRENT. A partial `select` that omits
 * `lifecycleState` yields `undefined`, and the old helper's equivalent mistake — treating an
 * absent column as "active" — is what made a consumer-side filter a silent no-op.
 */
export function isCurrentOrUnknown(team: TeamLifecycleState | null | undefined): boolean {
  if (!team) return false
  return team.lifecycleState !== 'ARCHIVED'
}

/** Keep only franchises that are current or not yet classified. */
export function selectCurrentOrUnknown<T extends TeamLifecycleState>(teams: readonly T[]): T[] {
  return teams.filter(isCurrentOrUnknown)
}
