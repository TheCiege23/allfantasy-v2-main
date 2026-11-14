/**
 * Awards Engine — types for fantasy awards per league/season.
 * Supports NFL, NHL, NBA, MLB, NCAAB, NCAAF, SOCCER.
 */

export const AWARD_TYPES = [
  'gm_of_the_year',
  'best_draft',
  'trade_master',
  'waiver_wizard',
  'best_comeback',
  'biggest_upset',
  'rookie_king',
  'dynasty_builder',
] as const

export type AwardType = (typeof AWARD_TYPES)[number]

export const AWARD_LABELS: Record<AwardType, string> = {
  gm_of_the_year: 'GM of the Year',
  best_draft: 'Best Draft',
  trade_master: 'Trade Master',
  waiver_wizard: 'Waiver Wizard',
  best_comeback: 'Best Comeback',
  biggest_upset: 'Biggest Upset',
  rookie_king: 'Rookie King',
  dynasty_builder: 'Dynasty Builder',
}

export interface SeasonPerformanceInput {
  leagueId: string
  season: string
  sport: string
  /** managerId (platformUserId) -> metrics for that manager in this league/season */
  byManager: Record<
    string,
    {
      wins: number
      losses: number
      pointsFor: number
      pointsAgainst: number
      champion: boolean
      madePlayoffs: boolean
      playoffSeed: number | null
      playoffFinish: string | null
      playoffWins: number
      playoffLosses: number
      bestFinish: number | null
      draftScore: number
      waiverClaimCount: number
      tradeCount: number
      /** First season in this league (for Rookie King) */
      isRookie: boolean
      /** Seasons played in this league (for Dynasty Builder) */
      seasonsInLeague: number
      championshipCount: number
      playoffAppearanceCount: number
    }
  >
}

export interface AwardRecordView {
  awardId: string
  leagueId: string
  sport: string
  season: string
  awardType: string
  awardLabel: string
  managerId: string
  score: number
  createdAt: Date
}
