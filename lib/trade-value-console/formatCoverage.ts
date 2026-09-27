import { getConceptById } from '@/lib/league-rules/conceptCatalog'
import { resolveLeagueConcept } from '@/lib/league/leagueConceptOptions'

/** Coverage of the shared proposal grader, distinct from advisory format notes. */
const GAPS: Record<string, string> = {
  keeper: 'Keeper costs and future keeper surplus are not included in the displayed player values.',
  salary_cap: 'Contract surplus and future salary commitments are not included in player values. A separate cap check evaluates affordability when configured.',
  guillotine: 'The grade uses current chart and roster values; future chopped-player releases and survival horizon are not priced.',
  survivor: 'Tribe transfers, immunity assets and elimination state are not priced into the grade.',
  survivor_guillotine: 'The expanding lineup and future player-pool releases are not priced; this format prohibits trades.',
  best_ball: 'Best Ball weekly lineup optimization and spike-week distributions are not priced into the grade.',
  big_brother: 'Eviction, immunity and nomination state are not priced into the grade.',
  zombie: 'Infection, weapons and serum effects are not priced into the grade.',
  pirate: 'Protection and steal exposure are advisory context and are not priced into the grade.',
  devy: 'College scouting uses devy points, a separate scale. No verified conversion to NFL trade values is available.',
  c2c: 'College and NFL assets use different value scales. Their cross-scale conversion is not established.',
  tournament: 'Tournament entries do not trade with one another; a seasonal chart is not a tournament acquisition price.',
}

export function tradeFormatCoverage(input: { settings: unknown; leagueType?: string | null }) {
  const concept = String(resolveLeagueConcept(input.settings, input.leagueType) ?? '').toLowerCase()
  const entry = getConceptById(concept)
  const trade = entry?.actions.find(a => a.id === 'trade')
  return {
    gaps: GAPS[concept] ? [GAPS[concept]] : [],
    prohibitedReason: trade?.legalInFormat === false
      ? `${entry!.label}: trades are not permitted by this format. ${trade.note ?? ''}`.trim() : null,
  }
}
