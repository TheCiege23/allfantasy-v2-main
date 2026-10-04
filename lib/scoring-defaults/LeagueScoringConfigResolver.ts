/**
 * Effective league scoring for UI + AI: `getLeagueScoringRules` (template + `LeagueScoringOverride`).
 * Downstream: `resolveScoringRulesForLeague` → weekly processor / matchup engine; `buildLeagueScoringContextForAi`
 * for start-sit + matchup routes; IDP `getMergedScoringRulesForLeague` overlays `idp_*` from the same rules.
 */
import { nativeCategoryScoringContext, type NativeCategoryScoringContext } from '@/lib/category-scoring/nativeCategoryScoringContext'
import { prisma } from '@/lib/prisma'
import {
  getLeagueSettingsForScoring,
  resolveFormatTypeFromLeagueSettings,
} from '@/lib/multi-sport/MultiSportScoringResolver'
import { resolveSportConfigForLeague } from '@/lib/multi-sport/SportConfigResolver'
import {
  getLeagueScoringRules,
  getScoringTemplate,
  type ScoringRuleDto,
} from '@/lib/multi-sport/ScoringTemplateResolver'
import { getLeagueScoringOverrides } from './ScoringOverrideService'
import { normalizeScoringStatKey } from './ScoringKeyAliasResolver'

export interface LeagueScoringRuleConfig extends ScoringRuleDto {
  defaultPointsValue: number
  defaultEnabled: boolean
  isOverridden: boolean
}

export interface LeagueScoringConfig {
  leagueId: string
  sport: string
  leagueVariant: string | null
  formatType: string
  templateId: string
  rules: LeagueScoringRuleConfig[]
  categoryScoring?: NativeCategoryScoringContext
}

/**
 * Compact rule summary for AI routes (start/sit, matchup, waiver) — uses live overrides + template.
 */
export async function buildLeagueScoringContextForAi(leagueId: string): Promise<string | null> {
  const config = await getLeagueScoringConfig(leagueId)
  if (!config) return null
  if (config.categoryScoring) return `${config.sport} category scoring: ${JSON.stringify(config.categoryScoring)}. Compare category impact; sum made and attempted stats before calculating percentages.`
  const active = config.rules
    .filter((r) => r.enabled && Math.abs(r.pointsValue) > 1e-9)
    .slice(0, 56)
    .map((r) => `${r.statKey}=${r.pointsValue}`)
  const s = `${config.sport} · ${config.formatType} · ${active.join('; ')}`
  return s.length > 8000 ? `${s.slice(0, 8000)}…` : s
}

export async function getLeagueScoringConfig(
  leagueId: string
): Promise<LeagueScoringConfig | null> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { sport: true, leagueVariant: true },
  })
  if (!league) return null

  const settings = await getLeagueSettingsForScoring(leagueId)
  const categoryScoring = nativeCategoryScoringContext(settings, String(league.sport))
  if (categoryScoring) return { leagueId, sport: league.sport, leagueVariant: league.leagueVariant ?? null, formatType: String(categoryScoring.mode), templateId: categoryScoring.presetId, rules: [], categoryScoring }
  const sportConfig = resolveSportConfigForLeague(league.sport)
  const formatType =
    resolveFormatTypeFromLeagueSettings(league.sport, settings) ??
    sportConfig.defaultFormat

  const [template, effectiveRules, overrides] = await Promise.all([
    getScoringTemplate(league.sport, formatType),
    getLeagueScoringRules(leagueId, league.sport, formatType),
    getLeagueScoringOverrides(leagueId),
  ])

  const templateRuleByKey = new Map(
    template.rules.map((rule) => [rule.statKey, rule])
  )
  const overrideByKey = new Map<string, (typeof overrides)[number]>()
  for (const o of overrides) {
    const canonical = normalizeScoringStatKey(o.statKey, {
      sportType: league.sport,
      templateRuleKeys: templateRuleByKey.keys(),
    })
    if (!templateRuleByKey.has(canonical)) continue
    overrideByKey.set(canonical, o)
  }

  return {
    leagueId,
    sport: league.sport,
    leagueVariant: league.leagueVariant ?? null,
    formatType,
    templateId: template.templateId,
    rules: effectiveRules.map((rule) => {
      const defaultRule = templateRuleByKey.get(rule.statKey)
      return {
        ...rule,
        defaultPointsValue: defaultRule?.pointsValue ?? rule.pointsValue,
        defaultEnabled: defaultRule?.enabled ?? rule.enabled,
        isOverridden: overrideByKey.has(rule.statKey),
      }
    }),
  }
}
