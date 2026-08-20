import type { LeagueCreationAnalyticsEvent } from '@/lib/analytics/league-creation/types'

/** Maps first blocking issue code to a coarse friction bucket (analytics only). */
export function classifyValidationFrictionKind(
  codes: string[],
): NonNullable<LeagueCreationAnalyticsEvent['validationFrictionKind']> {
  const c = codes[0] ?? ''
  if (
    c === 'concept_required' ||
    c === 'sport_required' ||
    c === 'scoring_required' ||
    c === 'team_count_required' ||
    c === 'league_name_invalid' ||
    c === 'draft_required'
  ) {
    return 'missing_required'
  }
  if (c === 'scoring_invalid' || c === 'team_count_invalid' || c === 'draft_invalid') {
    return 'invalid_combination'
  }
  return 'unsupported_settings'
}

/** Drops undefined keys so payloads stay compact for future POST bodies. */
export function compactLeagueCreationAnalyticsEvent(
  e: LeagueCreationAnalyticsEvent,
): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {}
  for (const [k, v] of Object.entries(e)) {
    if (v === undefined) continue
    out[k] = v as string | number | boolean | null
  }
  return out
}
