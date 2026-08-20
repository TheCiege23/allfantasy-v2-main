/**
 * League creation templates — structured metadata (Phase 3B Template Mode).
 * Wire IDs to `getQuickTemplatePatch` / canonical create pipeline.
 */

export const LEAGUE_CREATION_TEMPLATE_IDS = [
  'casual_redraft',
  'competitive_redraft',
  'dynasty',
  'best_ball',
  'guillotine',
] as const

export type LeagueCreationTemplateId = (typeof LEAGUE_CREATION_TEMPLATE_IDS)[number]

export type LeagueCreationTemplateComplexity = 'casual' | 'moderate' | 'advanced'

export type LeagueCreationTemplateVisibilityHint = 'private' | 'public_or_private' | 'mostly_private'

/** Rich copy + guidance; gameplay fields align with review snapshot language where possible. */
export interface LeagueCreationTemplateMeta {
  id: LeagueCreationTemplateId
  title: string
  shortDescription: string
  recommendedPlayerType: string
  gameplayStyle: string
  rosterStyle: string
  waiverStyle: string
  draftStyle: string
  scoringStyle: string
  complexity: LeagueCreationTemplateComplexity
  visibilityRecommendation: string
  visibilityHint: LeagueCreationTemplateVisibilityHint
  commissionerGuidance: string
}
