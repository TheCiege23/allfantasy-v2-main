import { prisma } from '@/lib/prisma'
import { getGuillotineConfig } from '../GuillotineLeagueConfig'
import { loadChopPreview } from '../chopPreviewLoad'
import { loadSurvivalOutlook } from '../survivalOutlookLoad'
import { buildSurvivalAnalysis, type SurvivalAnalysis } from './survivalAnalysis'

export type { SurvivalAnalysis }

export type SurvivalAnalysisResult =
  | { ok: true; analysis: SurvivalAnalysis }
  | { ok: false; status: 404 | 409; error: string }

/**
 * A team's survival analysis for the week being played (rules in ./survivalAnalysis.ts). It returned a fixed
 * 72% for every team before. Who may ask is the route's job; this only works the numbers out.
 */
export async function generateSurvivalAnalysis(input: { leagueId: string; seasonId: string; rosterId: string; scoringPeriod: number }): Promise<SurvivalAnalysisResult> {
  const preview = await loadChopPreview(input.leagueId)
  if ('error' in preview) return { ok: false, status: 409, error: preview.error }
  if (preview.outcome !== 'chop' && preview.outcome !== 'no_chop_week') {
    return { ok: false, status: 409, error: preview.headline || 'There is no chop to work odds out for.' }
  }
  if (preview.week !== input.scoringPeriod) {
    return { ok: false, status: 409, error: `Survival odds are worked out for the week being played, week ${preview.week}.` }
  }
  const [outlook, config] = await Promise.all([
    loadSurvivalOutlook(input.leagueId, preview.week).catch(() => null),
    getGuillotineConfig(input.leagueId).catch(() => null),
  ])
  const analysis = buildSurvivalAnalysis({ rosterId: input.rosterId, preview, outlook, dangerMarginPoints: config?.dangerMarginPoints ?? 10 })
  if (!analysis) return { ok: false, status: 404, error: 'That team is not alive in this league.' }

  await prisma.guillotineAIInsight
    .create({
      data: {
        leagueId: input.leagueId,
        seasonId: input.seasonId,
        rosterId: input.rosterId,
        scoringPeriod: preview.week,
        type: 'survival_probability',
        content: analysis as object,
        narrative: analysis.narrative,
      },
    })
    .catch(() => {})
  return { ok: true, analysis }
}
