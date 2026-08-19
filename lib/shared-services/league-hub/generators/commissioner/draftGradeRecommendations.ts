/**
 * Commissioner OS League-Specific Intelligence Wiring phase — Part 10,
 * draft-grade domain.
 *
 * Reuses `lib/rankings-engine/draft-grades.ts`'s already-persisted
 * `DraftGrade` rows (real, live, production-wired per this phase's Part 1
 * inventory — `computeDraftGrades`/`getDraftGrades`, wired to
 * `app/api/leagues/[leagueId]/draft-grades/route.ts`). Never calls
 * `computeDraftGrades` itself, never fabricates a grade when the league
 * has no draft data (`context.unavailableDomains` already marks
 * `'draft_grades'` when `DraftGrade` has zero rows for the current season).
 *
 * Real, disclosed limitation carried through honestly (not silently
 * hidden): the live engine is confirmed format-naive (no keeper/dynasty/
 * scoring-settings branching) — this generator's copy says so explicitly
 * rather than implying a format-aware grade. A separate, better
 * reach/value-detection engine (`lib/live-draft-brain/post-draft-grade.ts::gradeTeamDraft`)
 * exists but is confirmed orphaned (zero real callers) — not wired in this
 * phase; "best pick"/"biggest reach" content is therefore not produced
 * here, only league-wide grade distribution (best/worst grade), which the
 * live `DraftGrade` rows can support honestly on their own.
 */
import type { CommissionerOsContext } from '../../commissionerOsContext'
import { buildRecommendation, isFreshnessSafeForPriority } from '../../userOsRecommendationHelpers'
import { buildCopyReadyContent } from './copyReadyContent'
import type { LeagueRecommendation } from '../../types'

export function generateDraftGradeRecommendations(
  context: CommissionerOsContext,
  generatedAt: string
): LeagueRecommendation[] {
  if (context.unavailableDomains.includes('draft_grades')) return []
  if (context.draftGrades.length === 0) return []

  const priority = 'low' as const
  if (!isFreshnessSafeForPriority(context.syncFreshness, priority)) return []

  const sorted = [...context.draftGrades].sort((a, b) => b.score - a.score)
  const best = sorted[0]
  const worst = sorted[sorted.length - 1]

  const title = `Draft grades ready for ${context.draftGrades.length} team(s)`
  const summary = `Best grade: ${best.grade} (roster ${best.rosterId}). Lowest grade: ${worst.grade} (roster ${worst.rosterId}). Format-naive scoring — does not yet account for keeper/dynasty rules.`

  return [
    buildRecommendation({
      leagueId: context.canonicalLeagueId,
      domain: 'commissioner',
      type: 'draft_grade_summary',
      key: `season-${best.season}`,
      priority,
      title,
      summary,
      rationale: [
        `${context.draftGrades.length} real, persisted draft grade(s) found for this season.`,
        'Grading engine is confirmed format-naive (no keeper/dynasty/scoring-settings adjustment) — disclosed, not hidden.',
      ],
      evidence: context.draftGrades.map((g) => ({ label: `Roster ${g.rosterId}`, detail: `${g.grade} (${g.score.toFixed(1)})`, source: 'DraftGrade' })),
      relatedTeamIds: context.draftGrades.map((g) => g.rosterId),
      sourceFreshness: context.syncFreshness,
      executionCapability: 'copy_action',
      commissionerScope: 'single_draft',
      publicationAudience: 'league_wide',
      publicationChannel: 'league_chat',
      governanceSeverity: 'none',
      copyReadyContent: buildCopyReadyContent(title, summary, ['league_chat', 'discord']),
      generatedAt,
    }),
  ]
}
