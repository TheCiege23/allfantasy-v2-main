/**
 * The one vocabulary for `RedraftSeason.status`, and the one scope an engine runs over.
 *
 * 🛑 THIS COLUMN HAD TWO VOCABULARIES AND NOTHING COULD SEE IT. `status` is a free
 * `String` with no Prisma enum, and the two writers disagree:
 *
 *   lib/redraft/finalizeDraftToRedraftSeason.ts      -> 'active'
 *   lib/league-import/canonicalSeasonMaterialization -> 'in_season'
 *
 * Every engine filtered for `'active'` only. Measured against production
 * 2026-09-07: **242 of 246 seasons carry `'in_season'`** and were therefore
 * invisible to live scoring, waiver processing and the team-defense import —
 * silently, with nothing red anywhere, because a string that does not match is
 * not an error.
 *
 * ⚠ AND THE EXCLUSION LOOKED DELIBERATE WITHOUT BEING DELIBERATE. All 242 are
 * imported leagues, so "engines skip imports" is a defensible product rule — but
 * no engine implemented that rule. Not one mentions platforms, imports or
 * `isShadowLeague`; they compared a string, and the right-looking outcome was a
 * coincidence of two writers drifting apart. This module makes the same outcome
 * explicit and reversible: `ENGINE_SEASON_SCOPE` names both halves, and flipping
 * the shadow half is one argument rather than a data migration.
 */

import type { Prisma } from '@prisma/client'
import { NATIVE_PLATFORM_VALUES } from '@/lib/dashboard/platform-label'

/**
 * Canonical statuses, as the schedule and playoff runtimes already use them.
 * `setup` -> `active` -> `regular_season_complete` -> `playoffs` -> `complete`.
 */
export const REDRAFT_SEASON_STATUS = {
  SETUP: 'setup',
  ACTIVE: 'active',
  REGULAR_SEASON_COMPLETE: 'regular_season_complete',
  PLAYOFFS: 'playoffs',
  COMPLETE: 'complete',
} as const

export type RedraftSeasonStatus =
  (typeof REDRAFT_SEASON_STATUS)[keyof typeof REDRAFT_SEASON_STATUS]

/**
 * Statuses that mean `ACTIVE` but were written by another spelling.
 *
 * ⚠ NOT REWRITTEN IN THE DATABASE, AND THAT IS THE POINT. Migrating 242 rows
 * from `'in_season'` to `'active'` would be a one-line data change that
 * instantly enrolls 242 imported seasons into a live-scoring cron that polls a
 * provider every two minutes. That is a production load and cost event dressed
 * up as a tidy-up. Reading both spellings costs nothing and changes no
 * behaviour; the migration, if it is ever wanted, is a separate decision with a
 * separate blast radius.
 *
 * `drafting` is here for the same reason and is believed dead — no writer sets
 * it and production holds zero rows with it — but `waiver-process` filtered on
 * it, so dropping it silently would be a behaviour change smuggled into a
 * refactor.
 */
export const LEGACY_ACTIVE_STATUS_ALIASES: readonly string[] = ['in_season', 'drafting']

/** Every spelling that means "this season is running right now". */
export const RUNNING_SEASON_STATUSES: readonly string[] = [
  REDRAFT_SEASON_STATUS.ACTIVE,
  ...LEGACY_ACTIVE_STATUS_ALIASES,
]

/**
 * Map any stored spelling onto the canonical one. Returns null for a value this
 * module does not recognise — callers decide what to do with "unknown", exactly
 * as `normalizeSeasonType` does for the schedule feed. Guessing `ACTIVE` here
 * would enroll an unknown season into every engine.
 */
export function normalizeRedraftSeasonStatus(raw: unknown): RedraftSeasonStatus | null {
  const value = String(raw ?? '').trim().toLowerCase()
  if (!value) return null
  if (RUNNING_SEASON_STATUSES.includes(value)) return REDRAFT_SEASON_STATUS.ACTIVE
  const canonical = Object.values(REDRAFT_SEASON_STATUS) as string[]
  return canonical.includes(value) ? (value as RedraftSeasonStatus) : null
}

export function isRunningSeasonStatus(raw: unknown): boolean {
  return normalizeRedraftSeasonStatus(raw) === REDRAFT_SEASON_STATUS.ACTIVE
}

export type EngineSeasonScopeOptions = {
  /**
   * Include imported (shadow) leagues.
   *
   * Defaults to FALSE, which preserves today's behaviour exactly — see the
   * module header: the engines already skip every import, they just did it by
   * accident. Flipping this is a real product decision with a real cost (242
   * more seasons through a 2-minute provider poll), so it is a deliberate
   * argument rather than a default.
   */
  includeShadowLeagues?: boolean
  /** Restrict to specific sports, e.g. the NFL-only live-scoring provider. */
  sports?: readonly string[]
  /** Override the status set — playoff-phase jobs want a different one. */
  statuses?: readonly string[]
}

/**
 * The `where` clause an engine should run over.
 *
 * ⚠ ON THE NULL CASE, WHICH LOOKS LIKE A HOLE AND IS NOT. `isNativePlatform`
 * treats null/undefined as native (it defaults to `'allfantasy'`), and a Prisma
 * `{ in: [...] }` never matches NULL — so a `{ in: NATIVE }` filter and that
 * predicate would disagree about an unset platform. They cannot here:
 * `League.platform` is a non-nullable `String` in the schema, so no row can
 * reach this query with a null. An EMPTY string can, and is correctly excluded:
 * `resolveWriteAuthority` classifies `''` as SHADOW on purpose ("a spurious
 * shadow banner is cosmetic; a false native claim is not"), so dropping it from
 * an engine scope is the same fail-safe direction, not an oversight.
 */
export function engineSeasonScope(
  options: EngineSeasonScopeOptions = {},
): Prisma.RedraftSeasonWhereInput {
  const where: Prisma.RedraftSeasonWhereInput = {
    status: { in: [...(options.statuses ?? RUNNING_SEASON_STATUSES)] },
  }

  if (options.sports && options.sports.length > 0) {
    where.sport = { in: [...options.sports] }
  }

  if (!options.includeShadowLeagues) {
    where.league = { platform: { in: [...NATIVE_PLATFORM_VALUES] } }
  }

  return where
}
