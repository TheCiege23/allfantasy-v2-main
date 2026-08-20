import type { TabDef } from '@/app/league/[leagueId]/LeagueTabs'
import {
  isPreDraftOrDrafting,
  resolveLeagueStage,
  type LeagueStageInput,
} from '@/lib/league-stage/leagueStage'

/** Lifecycle states where the primary game tab should be Matchup (in-season command center), not Draft. */
const MATCHUP_PRIMARY_LIFECYCLES = new Set([
  'post_draft',
  'in_season',
  'playoffs',
  'completed',
  'archived',
])

/**
 * When true, the first-column tab should be `matchup` instead of `draft` (NFL-style tab strips)
 * or inserted before roster/squad (basketball/soccer).
 *
 * ⚠ TAKES THE LEAGUE, NOT A LIFECYCLE STRING. This used to accept `lifecycleState`
 * alone, and `lifecycleState` is `@default(in_season)` for imported leagues our state
 * machine never ran on. Since `in_season` is a matchup-primary state, every imported
 * league matched -- including leagues that were mid-draft -- and `applyMatchupPrimaryTab`
 * REPLACES the draft tab. Leagues actively drafting lost the Draft tab entirely.
 *
 * `resolveLeagueStage` prefers `status`, which the platform import actually writes.
 * The parameter is the league object so that passing only `lifecycleState` is no longer
 * expressible.
 */
export function shouldUseMatchupInsteadOfDraft(league: LeagueStageInput | null | undefined): boolean {
  const stage = resolveLeagueStage(league)
  if (stage === null) return false
  // A league still drafting keeps its Draft tab no matter what the other field says.
  if (isPreDraftOrDrafting(league)) return false
  return MATCHUP_PRIMARY_LIFECYCLES.has(stage)
}

/**
 * Replace leading `draft` with `matchup`, or insert `matchup` before roster/squad/leaderboard when
 * there is no draft tab (e.g. basketball / soccer).
 */
export function applyMatchupPrimaryTab(tabDefs: TabDef[], useMatchup: boolean): TabDef[] {
  if (!useMatchup) return tabDefs

  const draftIdx = tabDefs.findIndex((t) => t.id === 'draft')
  if (draftIdx >= 0) {
    const next = [...tabDefs]
    next[draftIdx] = { id: 'matchup', label: 'Matchup' }
    return next
  }

  const insertBefore = tabDefs.findIndex((t) => t.id === 'roster' || t.id === 'squad' || t.id === 'leaderboard')
  if (insertBefore >= 0) {
    const m: TabDef = { id: 'matchup', label: 'Matchup' }
    return [...tabDefs.slice(0, insertBefore), m, ...tabDefs.slice(insertBefore)]
  }

  return [{ id: 'matchup', label: 'Matchup' }, ...tabDefs]
}
