/**
 * PROMPT 3/5: Build Dynasty league context for Chimmy (standard Dynasty, Devy, or C2C).
 * AI never enforces rules. Use for: playoff format, SF vs 1QB, taxi vs devy, rookie draft order, reverse Max PF.
 */

import { prisma } from '@/lib/prisma'
import { getEffectiveDynastySettings } from './DynastySettingsService'
import { getEffectiveTaxiSettings } from '@/lib/taxi/TaxiSettingsService'
import { loadTaxiEnforcement } from '@/lib/taxi/taxiRulesService'
import { describeTaxiMoveRules } from '@/lib/taxi/taxiMoveRules'

export async function buildDynastyContextForChimmy(
  leagueId: string,
  _userId: string
): Promise<string> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { isDynasty: true, leagueVariant: true },
  })
  if (!league) return ''
  const variant = String(league.leagueVariant ?? '').toLowerCase()
  const isDynasty =
    league.isDynasty || variant === 'devy_dynasty' || variant === 'merged_devy_c2c'
  if (!isDynasty) return ''

  const [dynasty, taxi, taxiEnforcement] = await Promise.all([
    getEffectiveDynastySettings(leagueId),
    getEffectiveTaxiSettings(leagueId),
    loadTaxiEnforcement(leagueId).catch(() => null),
  ])
  if (!dynasty) return ''

  const parts: string[] = [
    '[DYNASTY MODE CONTEXT - for explanation only; you never enforce roster, scoring, playoff, or draft order rules]',
    `League is dynasty (or Devy/C2C). Roster format: ${dynasty.rosterFormatType}. Scoring: ${dynasty.scoringPresetName}. Playoffs: ${dynasty.playoffTeamCount} teams. Regular season: ${dynasty.regularSeasonWeeks} weeks.`,
    `Rookie draft: ${dynasty.rookieDraftRounds} rounds, ${dynasty.rookieDraftType}, order method: ${dynasty.rookiePickOrderMethod}. Non-playoff teams use reverse Max PF (anti-tank) when enabled: ${dynasty.useMaxPfForNonPlayoff}.`,
  ]
  if (taxi) {
    parts.push(
      `Taxi: ${taxi.taxiSlotCount} slots, eligibility: ${taxi.taxiEligibilityYears === 1 ? 'rookies only' : taxi.taxiEligibilityYears === 2 ? 'rookies + 2nd year' : 'rookies + 2nd + 3rd'}, lock: ${taxi.taxiLockBehavior}, scoring on taxi: ${taxi.taxiScoringOn}. Taxi is for stashing eligible young/pro prospects; Devy is for college/prospect rights in Devy or C2C.`
    )
  }
  // The one taxi fact that is enforced, not explained: a save that breaks it is refused.
  if (taxiEnforcement) parts.push(describeTaxiMoveRules(taxiEnforcement.rules))
  parts.push(
    'When the user asks: what playoff format should I use, should this league be SF or 1QB, how many taxi slots, difference between taxi and devy, how should rookie draft order work, what does reverse Max PF mean — explain using this context and league settings. Do not enforce or change settings.'
  )
  return parts.join(' ')
}
