/**
 * Detects NCAAF leagues that depend on beta/partial data pipelines.
 * Used to show honest empty-state banners instead of broken or silent UI.
 */

import type { UserLeague } from '@/app/dashboard/types'

type NcaafBetaStatus =
  | 'devy'       // NCAAF devy — college player pool not yet fully imported
  | 'c2c'        // NCAAF college-to-pro — mixed pool not yet ready
  | 'ncaaf'      // Plain NCAAF redraft — schedule/standings partially available
  | null         // Not an NCAAF beta league

export function getNcaafBetaStatus(league: UserLeague | null | undefined): NcaafBetaStatus {
  if (!league) return null
  const sport = String(league.sport ?? '').toUpperCase()
  if (sport !== 'NCAAF') return null

  const leagueType = String(
    (league as { leagueType?: string | null }).leagueType ?? ''
  ).toLowerCase()

  if (leagueType === 'devy' || leagueType.includes('devy')) return 'devy'
  if (leagueType === 'c2c' || leagueType.includes('c2c')) return 'c2c'
  return 'ncaaf'
}

export type BetaBannerInfo = {
  headline: string
  detail: string
  /** Data-testid for e2e assertions */
  testId: string
}

export function getNcaafBetaBannerInfo(status: NcaafBetaStatus): BetaBannerInfo | null {
  if (!status) return null
  if (status === 'devy') {
    return {
      headline: 'NCAAF Devy — Beta Data Pipeline',
      detail:
        'College player import for devy leagues is in beta. Player pool and fantasy stats will load when the NCAAF data import is complete. Roster shells and league settings are ready now.',
      testId: 'ncaaf-devy-beta-banner',
    }
  }
  if (status === 'c2c') {
    return {
      headline: 'NCAAF College-to-Pro — Beta Data Pipeline',
      detail:
        'The college-to-pro (C2C) player pool is in beta. Mixed NFL/college player data will load when the C2C import is complete. League structure, scoring, and draft settings are ready.',
      testId: 'ncaaf-c2c-beta-banner',
    }
  }
  return {
    headline: 'NCAAF — Partial Data Pipeline',
    detail:
      'NCAAF schedule, standings, and player stats are partially connected. Some data may be incomplete until the full NCAAF data import is finished.',
    testId: 'ncaaf-beta-banner',
  }
}

/** True when the league needs a "player pool pending" empty state in the Players tab. */
export function isNcaafPlayerPoolPending(league: UserLeague | null | undefined): boolean {
  const status = getNcaafBetaStatus(league)
  // devy and c2c have no AllFantasy native player pool yet; plain ncaaf has partial Sleeper data
  return status === 'devy' || status === 'c2c'
}
