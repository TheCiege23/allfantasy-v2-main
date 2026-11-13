import type { LeagueSport } from '@prisma/client'
import { getScoringDefaults } from '@/lib/sport-defaults/SportDefaultsRegistry'
import { normalizeToSupportedSport, supportsIdpLeagueSport } from '@/lib/sport-scope'

export type FormatScoringModifierId =
  | 'superflex'
  | 'idp'
  | 'te_premium'
  | 'taxi'
  | 'devy'
  | 'c2c'
  | 'salary_cap'
  | 'best_ball'

type FormatScoringProfile = {
  sport: LeagueSport
  scoringTemplateId: string
  scoringFormat: string
  categoryType: 'points' | 'category' | 'roto'
  defaultMode: 'points' | 'category' | 'roto'
  modifiers: FormatScoringModifierId[]
  rules: Array<{ statKey: string; pointsValue: number }>
}

const CATEGORY_SPORTS = new Set<LeagueSport>(['NBA', 'MLB', 'NHL', 'SOCCER'])

function normalizeVariantForScoring(
  sport: LeagueSport,
  formatId?: string | null,
  modifiers: FormatScoringModifierId[] = []
): string | undefined {
  if (modifiers.includes('idp') && supportsIdpLeagueSport(sport)) return 'IDP'
  if (modifiers.includes('superflex') && sport === 'NFL') return 'SUPERFLEX'
  return formatId ?? undefined
}

export function resolveFormatScoringDefaults(options: {
  sport: LeagueSport | string
  formatId?: string | null
  modifiers?: FormatScoringModifierId[]
}): FormatScoringProfile {
  const sport = normalizeToSupportedSport(options.sport)
  const modifiers = [...new Set(options.modifiers ?? [])]
  const variant = normalizeVariantForScoring(sport, options.formatId, modifiers)
  const base = getScoringDefaults(sport, variant)

  const rules = [...(base.scoring_rules ?? [])].map((rule) => ({
    statKey: rule.statKey,
    pointsValue: rule.pointsValue,
  }))

  if (modifiers.includes('te_premium')) {
    rules.push({ statKey: 'bonus_rec_te', pointsValue: 0.5 })
  }

  const defaultMode =
    base.category_type === 'category' || CATEGORY_SPORTS.has(sport)
      ? base.category_type
      : 'points'

  return {
    sport,
    scoringTemplateId: base.scoring_template_id,
    scoringFormat:
      options.formatId === 'best_ball'
        ? `Best Ball ${base.scoring_format}`
        : options.formatId === 'salary_cap'
          ? `${base.scoring_format} + contracts`
          : base.scoring_format,
    categoryType: base.category_type,
    defaultMode,
    modifiers,
    rules,
  }
}
