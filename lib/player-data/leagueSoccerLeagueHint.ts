/**
 * Resolve Rolling Insights soccer `league` (EPL | LALIGA | SERIEA) from stored league settings JSON.
 */

import type { RollingInsightsSoccerLeagueCode } from '@/lib/providers/rollingInsightsSoccerLeague'
import { normalizeSoccerLeague } from '@/lib/providers/rollingInsightsSoccerLeague'

export function soccerLeagueHintFromLeagueSettings(settings: unknown): RollingInsightsSoccerLeagueCode | null {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null
  const o = settings as Record<string, unknown>
  return normalizeSoccerLeague(
    o.soccerLeague ?? o.soccer_competition ?? o.competition ?? o.leagueCode ?? o.soccerLeagueCode,
  )
}
