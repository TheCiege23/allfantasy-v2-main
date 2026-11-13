/**
 * League Intelligence Engine — Premium AI League Analysis
 *
 * Layers deep team intelligence on top of the existing rankings engine.
 * Produces per-team grades, health scores, recommendations, and
 * league-wide insights (most overrated, dangerous underdog, etc.).
 *
 * Consumes: rankingsEngine, league-intelligence, contender.ts, team-context-adjustment.
 * Pure deterministic. No AI calls. Target: <50ms for full league.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TeamGrade = 'S' | 'A+' | 'A' | 'B+' | 'B' | 'C+' | 'C' | 'D' | 'F'

type TeamTrend = 'rising' | 'stable' | 'falling' | 'volatile'

type TeamCategory = 'elite_contender' | 'contender' | 'playoff_bubble' | 'middle_pack' | 'retooling' | 'rebuilding' | 'tanking'

type RecommendedAction =
  | 'push_for_title'
  | 'buy_depth'
  | 'sell_aging_assets'
  | 'trade_for_win_now'
  | 'start_rebuild'
  | 'hold_steady'
  | 'accumulate_picks'
  | 'trade_for_youth'
  | 'address_weakness'

interface TeamIntelCard {
  rosterId: number
  teamName: string
  managerId: string | null

  // Overall grade
  grade: TeamGrade
  powerScore: number         // 0-100

  // Dimension scores
  rosterHealthScore: number  // 0-100 (injury exposure + age profile)
  depthScore: number         // 0-100 (bench quality vs league)
  futureAssetScore: number   // 0-100 (picks + youth)
  championshipWindowScore: number // 0-100

  // Classification
  category: TeamCategory
  trend: TeamTrend
  riskLevel: 'low' | 'medium' | 'high' | 'extreme'

  // Analysis
  biggestStrength: string
  biggestWeakness: string
  recommendedAction: RecommendedAction
  recommendationExplanation: string
  futureOutlook: string       // 1-2 sentence outlook

  // Positional detail
  needs: string[]
  surplus: string[]
  starterValue: number
  benchValue: number
  pickValue: number

  // Luck & performance
  luckScore: number           // 0-100 (50 = neutral, >50 = lucky, <50 = unlucky)
  performanceLabel: 'overperforming' | 'underperforming' | 'on_pace'

  // Risk flags
  riskFlags: string[]
}

interface LeagueWideInsights {
  strongestTeam: { teamName: string; reason: string }
  mostOverratedTeam: { teamName: string; reason: string } | null
  mostDangerousUnderdog: { teamName: string; reason: string } | null
  bestRebuild: { teamName: string; reason: string } | null
  bestTradeTargetRoster: { teamName: string; reason: string } | null
  volatilityRanking: { teamName: string; volatility: number }[]
  leagueCompetitiveness: 'tight' | 'moderate' | 'lopsided'
  contenderCount: number
  rebuilderCount: number
}

export interface LeagueIntelResult {
  teamCards: TeamIntelCard[]
  leagueInsights: LeagueWideInsights
  computedAt: string
}

// ---------------------------------------------------------------------------
// Input (flexible — works with what's available)
// ---------------------------------------------------------------------------

export interface LeagueIntelInput {
  teams: Array<{
    rosterId: number
    teamName: string
    managerId?: string | null
    /** Assets by type */
    starterValue: number
    benchValue: number
    pickValue: number
    totalValue: number
    /** Roster composition */
    needs: string[]
    surplus: string[]
    youngAssetCount: number
    pickCount: number
    rosterSize: number
    starterCount: number
    /** Performance */
    wins: number
    losses: number
    pointsFor: number
    /** Classification from existing engine */
    contenderTier: 'champion' | 'contender' | 'middle' | 'rebuild'
    starterStrengthIndex: number
    /** Optional enrichment */
    injuredPlayerCount?: number
    avgAge?: number
    agingAssetCount?: number // players past decline age
  }>
  leagueAvgPoints: number
  numTeams: number
  isDynasty: boolean
  isSF: boolean
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Dimension Scoring
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Luck Score
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Recommendations
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Risk & Trend
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Power Score (composite)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// League-Wide Insights
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Main Entry Point
// ---------------------------------------------------------------------------

