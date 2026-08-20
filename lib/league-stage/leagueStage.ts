/**
 * Where a league actually is in its year.
 *
 * TWO FIELDS DISAGREE, AND ONE OF THEM IS USUALLY JUST ITS DEFAULT.
 *
 * `League.status` is written by the platform import -- it is the source platform's
 * own word for the league's phase (`pre_draft`, `drafting`, `in_season`, `setup`).
 *
 * `League.lifecycleState` is written by our own state machine, and that machine has
 * never run for imported leagues. It is declared `@default(in_season)`, so for an
 * imported league it reads `in_season` whether or not the league has drafted. On a
 * production sample of 62 leagues, 55 sat on that default while `status` reported 11
 * `drafting` and 8 `pre_draft`.
 *
 * So the platform's word wins and ours is the fallback. Reversing that precedence
 * labels every undrafted imported league "in season" -- which is exactly how the
 * league tab strip came to replace the Draft tab with Matchup for leagues that were
 * mid-draft.
 *
 * This mirrors `stageOf` in lib/core-app/dash34.ts, which got the precedence right;
 * this module exists so the rule has one home instead of being re-derived per caller.
 */
export type LeagueStageInput = {
  status?: string | null
  lifecycleState?: string | null
}

/** The league's effective stage, lower-cased, or null when neither field says anything. */
export function resolveLeagueStage(league: LeagueStageInput | null | undefined): string | null {
  const raw = String(league?.status ?? league?.lifecycleState ?? '')
    .toLowerCase()
    .trim()
  return raw || null
}

/** Stages where the league has not yet finished drafting. */
const PRE_SEASON_STAGES = new Set(['setup', 'pre_draft', 'predraft', 'drafting', 'draft'])

/**
 * True when the league has not finished its draft, so draft-time surfaces must stay
 * visible. Takes the whole league rather than a bare stage string: passing only
 * `lifecycleState` is the mistake this module exists to prevent, and a single-field
 * signature invites it.
 */
export function isPreDraftOrDrafting(league: LeagueStageInput | null | undefined): boolean {
  const stage = resolveLeagueStage(league)
  return stage !== null && PRE_SEASON_STAGES.has(stage)
}
