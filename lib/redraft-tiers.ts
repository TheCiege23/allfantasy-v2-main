/**
 * Redraft Trade Evaluator - 4-Layer Deterministic System
 * 
 * Unlike dynasty, redraft focuses on:
 * - Rest-of-season (ROS) projections
 * - Positional replacement value (PAR)
 * - Playoff schedule strength
 * - Starting lineup impact
 * - Risk/volatility
 */

// ============================================================================
// LAYER 1: REDRAFT TIERS (Weekly Impact Tiers)
// ============================================================================

export type RedraftTier = 'A' | 'B' | 'C' | 'D' | 'F';

export interface RedraftTierInfo {
  tier: RedraftTier;
  parRange: [number, number]; // Points Above Replacement range
  description: string;
}

export function getRedraftTierFromPAR(par: number): RedraftTier {
  if (par >= 6.0) return 'A';
  if (par >= 3.0) return 'B';
  if (par >= 1.0) return 'C';
  if (par >= 0) return 'D';
  return 'F';
}

// ============================================================================
// LAYER 2: POSITIONAL REPLACEMENT VALUE (Redraft's Secret Sauce)
// ============================================================================

export type Position = 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DEF';
export type LeagueSize = 8 | 10 | 12 | 14 | 16;
export type ScoringFormat = 'standard' | 'half_ppr' | 'ppr' | 'superflex';

export interface ReplacementBaselines {
  QB: number;
  RB: number;
  WR: number;
  TE: number;
  K: number;
  DEF: number;
}

// Replacement baselines by league size (weekly PPG)
const REPLACEMENT_BASELINES: Record<LeagueSize, ReplacementBaselines> = {
  8: { QB: 18, RB: 12, WR: 13, TE: 9, K: 8, DEF: 7 },
  10: { QB: 17, RB: 11, WR: 12, TE: 8.5, K: 7.5, DEF: 6.5 },
  12: { QB: 16, RB: 10, WR: 11, TE: 8, K: 7, DEF: 6 },
  14: { QB: 15, RB: 9, WR: 10, TE: 7.5, K: 6.5, DEF: 5.5 },
  16: { QB: 14, RB: 8, WR: 9, TE: 7, K: 6, DEF: 5 },
};

// Scoring format adjustments
const SCORING_ADJUSTMENTS: Record<ScoringFormat, Partial<ReplacementBaselines>> = {
  standard: { RB: 1, WR: -1 }, // RBs more valuable
  half_ppr: {}, // baseline
  ppr: { WR: 1, TE: 0.5, RB: -0.5 }, // WRs/TEs more valuable
  superflex: { QB: 2 }, // QBs way more valuable
};

export function getReplacementBaseline(
  position: Position,
  leagueSize: LeagueSize = 12,
  scoring: ScoringFormat = 'half_ppr'
): number {
  const base = REPLACEMENT_BASELINES[leagueSize][position];
  const adj = SCORING_ADJUSTMENTS[scoring][position] || 0;
  return base + adj;
}

// ============================================================================
// LAYER 3: MARKET PLAUSIBILITY (Redraft Edition)
// ============================================================================

export type RedraftWindowStatus = 
  | 'MUST_WIN_NOW'      // Poor record, needs weekly ceiling
  | 'PLAYOFF_LOCK'      // Can stash upside for playoffs
  | 'BUBBLE_TEAM'       // Optimize starters + floor
  | 'ELIMINATED';       // Future spoiler

export interface TeamContext {
  wins: number;
  losses: number;
  playoffSpots: number; // typically 4-6
  teamsInLeague: number;
  currentWeek: number;
  playoffStartWeek: number;
}

export function determineWindowStatus(ctx: TeamContext): RedraftWindowStatus {
  const winPct = ctx.wins / (ctx.wins + ctx.losses);
  const weeksLeft = ctx.playoffStartWeek - ctx.currentWeek;
  const gamesBack = Math.ceil((ctx.teamsInLeague / 2) - ctx.wins);
  
  // Already mathematically eliminated (rough heuristic)
  if (weeksLeft < gamesBack && winPct < 0.3) {
    return 'ELIMINATED';
  }
  
  // Playoff lock - top teams
  if (winPct >= 0.65 || (ctx.wins >= ctx.playoffSpots && weeksLeft <= 3)) {
    return 'PLAYOFF_LOCK';
  }
  
  // Must-win now - struggling teams
  if (winPct < 0.4 && weeksLeft <= 5) {
    return 'MUST_WIN_NOW';
  }
  
  // Everyone else is a bubble team
  return 'BUBBLE_TEAM';
}

export interface PlausibilityResult {
  isPlausible: boolean;
  reason: string;
  warning?: string;
}

export function checkRedraftPlausibility(
  senderStarterPARChange: number,
  senderBenchPARChange: number,
  senderWindowStatus: RedraftWindowStatus,
  receiverWindowStatus: RedraftWindowStatus
): PlausibilityResult {
  // If sender loses starter PAR and gains only bench PAR → unlikely
  if (senderStarterPARChange < -2 && senderBenchPARChange > 0 && senderStarterPARChange + senderBenchPARChange < 0) {
    return {
      isPlausible: false,
      reason: 'Sender loses starter value for bench depth - rarely accepted',
      warning: 'UNLIKELY_TRADE'
    };
  }
  
  // Must-win team buying boom assets at cost of depth
  if (senderWindowStatus === 'MUST_WIN_NOW' && senderBenchPARChange < -3) {
    return {
      isPlausible: true,
      reason: 'Must-win team sacrificing depth for upside',
      warning: 'MISALIGNED_STRATEGY'
    };
  }
  
  // Eliminated team acquiring assets
  if (senderWindowStatus === 'ELIMINATED' && senderStarterPARChange > 2) {
    return {
      isPlausible: true,
      reason: 'Eliminated team has no motivation to improve',
      warning: 'QUESTIONABLE_MOTIVATION'
    };
  }
  
  return { isPlausible: true, reason: 'Trade makes strategic sense for both sides' };
}

// ============================================================================
// LAYER 4: TIMELINE CONSISTENCY (Playoff Schedule)
// ============================================================================

export function getPlayoffMultiplier(avgDifficultyRank: number): number {
  // Top 8 easiest = boost, bottom 8 hardest = penalty
  if (avgDifficultyRank <= 8) return 1.10;
  if (avgDifficultyRank <= 16) return 1.05;
  if (avgDifficultyRank <= 24) return 0.98;
  return 0.92;
}

// Risk factors
export interface RiskProfile {
  injuryRisk: number; // 0-1 (0 = healthy, 1 = IR)
  roleVolatility: number; // 0-1 (0 = locked in, 1 = committee/uncertain)
  byeWeekRemaining: boolean;
}

export function getRiskFactor(risk: RiskProfile): number {
  let factor = 0;
  factor += risk.injuryRisk * 0.15;
  factor += risk.roleVolatility * 0.08;
  if (risk.byeWeekRemaining) factor += 0.02;
  return Math.min(factor, 0.25); // Cap at 25%
}

// ============================================================================
// COMPLETE VALUE FORMULA
// ============================================================================

export interface RedraftPlayerInput {
  name: string;
  position: Position;
  weeklyProjection: number; // PPG ROS
  remainingWeeks: number;
  isStarterForTeam: boolean;
  playoffDifficultyRank?: number; // 1-32
  riskProfile?: RiskProfile;
}

export interface RedraftPlayerValue {
  name: string;
  position: Position;
  baseROSPoints: number;
  par: number;
  parPerWeek: number;
  tier: RedraftTier;
  riskFactor: number;
  playoffMultiplier: number;
  starterMultiplier: number;
  adjustedValue: number;
  starterImpact: 'positive' | 'neutral' | 'negative';
}

export function calculateRedraftValue(
  player: RedraftPlayerInput,
  leagueSize: LeagueSize = 12,
  scoring: ScoringFormat = 'half_ppr'
): RedraftPlayerValue {
  // Base ROS points
  const baseROSPoints = player.weeklyProjection * player.remainingWeeks;
  
  // PAR calculation
  const replacement = getReplacementBaseline(player.position, leagueSize, scoring);
  const parPerWeek = player.weeklyProjection - replacement;
  const par = parPerWeek * player.remainingWeeks;
  
  // Tier
  const tier = getRedraftTierFromPAR(parPerWeek);
  
  // Risk adjustment
  const riskFactor = player.riskProfile ? getRiskFactor(player.riskProfile) : 0;
  const riskAdjustedPAR = par * (1 - riskFactor);
  
  // Playoff adjustment
  const playoffMultiplier = player.playoffDifficultyRank 
    ? getPlayoffMultiplier(player.playoffDifficultyRank)
    : 1.0;
  const playoffAdjustedPAR = riskAdjustedPAR * playoffMultiplier;
  
  // Starter adjustment
  const starterMultiplier = player.isStarterForTeam ? 1.10 : 0.85;
  const adjustedValue = playoffAdjustedPAR * starterMultiplier;
  
  // Starter impact
  let starterImpact: 'positive' | 'neutral' | 'negative' = 'neutral';
  if (player.isStarterForTeam && parPerWeek > 2) starterImpact = 'positive';
  else if (!player.isStarterForTeam && parPerWeek < 1) starterImpact = 'negative';
  
  return {
    name: player.name,
    position: player.position,
    baseROSPoints: Math.round(baseROSPoints * 10) / 10,
    par: Math.round(par * 10) / 10,
    parPerWeek: Math.round(parPerWeek * 10) / 10,
    tier,
    riskFactor: Math.round(riskFactor * 100) / 100,
    playoffMultiplier,
    starterMultiplier,
    adjustedValue: Math.round(adjustedValue * 10) / 10,
    starterImpact,
  };
}

// ============================================================================
// TRADE EVALUATION
// ============================================================================

export interface RedraftTradeInput {
  senderPlayers: RedraftPlayerInput[];
  receiverPlayers: RedraftPlayerInput[];
  senderContext?: TeamContext;
  receiverContext?: TeamContext;
  leagueSize?: LeagueSize;
  scoring?: ScoringFormat;
}

export type RedraftGrade = 'A+' | 'A' | 'A-' | 'B+' | 'B' | 'B-' | 'C+' | 'C' | 'C-' | 'D' | 'F';

export interface RedraftTradeResult {
  senderValues: RedraftPlayerValue[];
  receiverValues: RedraftPlayerValue[];
  senderTotalValue: number;
  receiverTotalValue: number;
  valueDelta: number;
  valueRatio: number;
  winner: 'sender' | 'receiver' | 'even';
  senderGrade: RedraftGrade;
  receiverGrade: RedraftGrade;
  maxGradeCap?: RedraftGrade;
  capReason?: string;
  verdict: 'FAIR' | 'SLIGHT_EDGE' | 'LOPSIDED' | 'BAD_TRADE' | 'UNREALISTIC';
  plausibility: PlausibilityResult;
  indicators: {
    starterImpact: 'positive' | 'neutral' | 'negative';
    rosPointsChange: number;
    playoffOutlook: 'helps' | 'hurts' | 'neutral';
  };
  tierViolation: boolean;
  tierViolationReason?: string;
}

// ============================================================================
// AI CONTEXT FOR REDRAFT
// ============================================================================

export function getRedraftAIContext(): string {
  return `
## REDRAFT TRADE EVALUATION RULES (MANDATORY)

Unlike dynasty, redraft trades focus on REST-OF-SEASON value, not long-term assets.

### LAYER 1: REDRAFT TIERS (Weekly Impact)
- Tier A: +6.0 PAR or more (League Winners)
- Tier B: +3.0 to +5.9 PAR (High-End Starters)
- Tier C: +1.0 to +2.9 PAR (Solid Starters)
- Tier D: 0 to +0.9 PAR (Fringe Starters)
- Tier F: Negative PAR (Waiver Level)

**HARD RULE:** If a trade gives up a Tier A starter for Tier D/F pieces, MAX GRADE = C-.

### LAYER 2: POSITIONAL REPLACEMENT VALUE
PAR = Weekly Points - Replacement Baseline

12-Team PPR Baselines:
- QB: 16 ppg | RB: 10 ppg | WR: 11 ppg | TE: 8 ppg

Key insight: A TE at 12 ppg (+4 PAR) is MORE valuable than a WR at 13 ppg (+2 PAR) due to scarcity.

### LAYER 3: MARKET PLAUSIBILITY
- If sender loses STARTER PAR and gains only BENCH PAR → UNLIKELY
- If "must-win" team buys boom at cost of depth → MISALIGNED

### LAYER 4: TIMELINE (Record + Playoffs)
- MUST_WIN_NOW: Boost immediate starters, stable workload
- PLAYOFF_LOCK: Boost playoff schedule, upside, handcuffs
- BUBBLE_TEAM: Optimize starters + floor

### GRADE BANDS (by value ratio)
- ≤1.10: A-/B+ (Fair)
- 1.10-1.25: B/C (Slight Edge)
- 1.25-1.45: D (Lopsided)
- ≥1.45: ❌ Bad/Unrealistic

### YOUR EXPLANATIONS MUST SOUND LIKE REDRAFT
DO say: "This adds +4.5 PAR to your starting lineup"
DO say: "Neither player cracks your starting lineup, so it's a loss"
DO say: "Playoff schedule makes this riskier"

DO NOT say: "Age curve" / "Picks" / "Multi-year window" / "Dynasty value"
`;
}
