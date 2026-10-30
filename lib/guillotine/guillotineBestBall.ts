/**
 * Best ball Guilly (2026-10-30): a guillotine league whose lineups set themselves. Each week every
 * team is scored on the best lineup its players' points could have filled — the same optimal lineup a
 * Best Ball league uses (lib/redraft/scoringEngine.ts `scoreRosterBestBall`) — so nobody sets a
 * lineup, and nobody is chopped for forgetting to.
 *
 * ⚠ STORED AS `League.settings.best_ball`, NOT AS `League.bestBallMode`. That column turns a league
 * into a Best Ball league everywhere: well over a hundred files read it to pick tabs, matchups,
 * playoffs and drafts. A Guilly league must stay a Guilly league; only its lineups change.
 * `settings.best_ball` is the existing "this league's lineups set themselves" flag (an imported
 * Sleeper best ball league carries it): auto-bench, auto-subs, inactive-manager lineups, lineup
 * alerts, My Team and Chimmy's lineup tools already read it (lib/core-app/lineupMode.ts,
 * teamWorkspace.ts `automaticLineup`), and none of them reads it as a league format. Scoring is the
 * one reader that needs telling, and only for a guillotine league (lib/redraft/scoringEngine.ts
 * `leagueIsBestBall`), so an imported league that carries the flag is scored exactly as before.
 *
 * Chosen at creation, or by the commissioner before the draft (./guillotineRulesSave.ts). It cannot
 * change once the draft has started: a team drafted for one way of scoring would be playing another.
 */

import { isBestBallSettings } from '@/lib/core-app/lineupMode'
import { resolveLeagueStage } from '@/lib/league-stage/leagueStage'

export const GUILLOTINE_BEST_BALL_KEY = 'best_ball'

/** The league's best ball lineup flag, read the way every other lineup reader reads it. Absent = off. */
export function readGuillotineBestBall(settings: unknown): boolean {
  return isBestBallSettings(settings)
}

/** A guillotine league, by the fields the league row carries. */
export function isGuillotineRow(league: { leagueType?: string | null; leagueVariant?: string | null; guillotineMode?: boolean | null }): boolean {
  return league.guillotineMode === true || league.leagueType === 'guillotine' || league.leagueVariant === 'guillotine'
}

/** A Guilly league whose lineups set themselves each week. */
export function isBestBallGuillotine(league: {
  leagueType?: string | null
  leagueVariant?: string | null
  guillotineMode?: boolean | null
  settings?: unknown
}): boolean {
  return isGuillotineRow(league) && readGuillotineBestBall(league.settings)
}

/** Stages before the first pick. `drafting` is not one: the teams are being built for a way of scoring. */
const BEFORE_DRAFT_STAGES = new Set(['setup', 'pre_draft', 'predraft'])

/** Best ball can be switched only before the draft (the same stages the dynasty sport preset uses). */
export function canChangeGuillotineBestBall(league: { status?: string | null; lifecycleState?: string | null }): boolean {
  const stage = resolveLeagueStage(league)
  return stage !== null && BEFORE_DRAFT_STAGES.has(stage)
}
