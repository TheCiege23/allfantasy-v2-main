import { findPlayerTier } from './dynasty-tiers';

// ============================================
// AI PROMPT TEMPLATES (Controlled AI Layer)
// ============================================
// AI can ONLY see candidate trades, values, needs, reasons, verdicts
// AI is FORBIDDEN from changing totals or proposing new values

export interface AITargetTeamsInput {
  candidateTrades: TradeCandidate[];
  leagueFacts: TeamFacts;
  standings: Array<{ team_id: string; team_name: string; wins: number; losses: number }>;
}

export interface AITargetTeamsOutput {
  targets: Array<{
    team_id: string;
    team_name: string;
    why_target: string[];
    best_offers: string[]; // offer IDs
    message_template: string;
  }>;
}

export interface AIRestructureInput {
  rejected_offer: TradeCandidate;
  rejection_reasons: string[];
  available_tradeable_pool: Asset[];
  constraints: Constraints;
}

export interface AIRestructureOutput {
  restructured_offers: Array<{
    based_on_offer_id: string;
    new_offer: TradeCandidate;
    why_this_is_more_acceptable: string[];
  }>;
}

export interface AIRiskAnalysisInput {
  offer: TradeCandidate;
  player_tags: Record<string, string[]>; // player_id -> ['young', 'injury_risk', etc]
  team_directions: Record<string, TeamDirection>;
  fairness_breakdown: HumanFairnessResult;
}

export interface AIRiskAnalysisOutput {
  offer_id: string;
  risk_summary: string[];
  timing_summary: string[];
  who_benefits_now: string;
  who_benefits_later: string;
}

// Trade candidate for AI layer
export interface TradeCandidate {
  offer_id: string;
  teamA_id: string;
  teamA_name: string;
  teamB_id: string;
  teamB_name: string;
  teamA_gives: Asset[];
  teamA_gets: Asset[];
  fairness: HumanFairnessResult;
  whyTeamAAccepts: string[];
  whyTeamBAccepts: string[];
}

// AI Prompt Templates (readonly strings)
export const AI_PROMPTS = {
  TARGET_TEAMS: `You are AllFantasy Trade Assistant. Your job is to choose the best target teams for trade outreach.

You are NOT allowed to propose new trades or change any values.
Use only the provided league facts: standings, roster needs, and the candidate trades already generated.

Return:
- the top 3 target teams
- for each, the 2 best offers (by acceptance likelihood)
- a short message template the user can send in chat

Output JSON only:
{
  "targets": [
    {
      "team_id": "...",
      "team_name": "...",
      "why_target": ["...","..."],
      "best_offers": ["offer_id_1","offer_id_2"],
      "message_template": "..."
    }
  ]
}`,

  RESTRUCTURE_REJECTED: `You are AllFantasy Trade Restructurer.
You may ONLY:
- swap ONE asset with a similar position/value
- add ONE premium balancing asset (pick/FAAB) if needed
- remove filler players
You must preserve the cornerstone and fairness rules.

Input: rejected_offer + rejection reasons + available tradeable pools.

Output JSON only:
{
  "restructured_offers": [
    {
      "based_on_offer_id": "...",
      "new_offer": { ...same offer schema... },
      "why_this_is_more_acceptable": ["...","..."]
    }
  ]
}`,

  RISK_TIMING: `You are AllFantasy Risk Analyst.
You are not allowed to change any assets or values.
Explain the risks and timing implications of the proposed trade using only provided facts:
- player age tags if provided
- injury risk tags if provided
- team direction (win now/rebuild)
- the fairness breakdown (value/scarcity/fit/market)

Output JSON only:
{
  "offer_id": "...",
  "risk_summary": ["...","..."],
  "timing_summary": ["...","..."],
  "who_benefits_now": "...",
  "who_benefits_later": "..."
}`
} as const;

// AI Rules (for prompt injection)
export const AI_RULES = {
  FORBIDDEN: [
    'Do NOT propose new trades outside the provided candidates',
    'Do NOT change any asset values',
    'Do NOT override fairness scores',
    'Do NOT invent facts not in the provided data',
    'Do NOT suggest trades that violate cornerstone rules'
  ],
  ALLOWED: [
    'Rank existing candidate trades',
    'Explain why a trade works for each team',
    'Suggest restructures within allowed constraints',
    'Explain risks using provided tags',
    'Generate message templates for outreach'
  ]
} as const;

// ============================================
// UI LABELS & DISPLAY SYSTEM
// ============================================

export type DisplayLabel = 'STRONG' | 'FAIR_AGGRESSIVE' | 'SPECULATIVE' | 'LONG_SHOT';
export type AcceptanceRate = 'HIGH' | 'MEDIUM' | 'LOW';
export type PriorityPill = 'HIGH_PRIORITY' | 'AGGRESSIVE' | 'SPECULATIVE' | 'LONG_SHOT';

export interface UILabels {
  displayLabel: DisplayLabel;
  displayText: string;
  displayEmoji: string;
  acceptanceRate: AcceptanceRate;
  acceptanceText: string;
  priorityPill: PriorityPill;
  priorityText: string;
}

// Map score to display label
export function getDisplayLabel(score: number): { label: DisplayLabel; text: string; emoji: string } {
  if (score >= 85) {
    return { label: 'STRONG', text: 'Strong Offer (Likely Accepted)', emoji: '✅' };
  }
  if (score >= 70) {
    return { label: 'FAIR_AGGRESSIVE', text: 'Fair but Aggressive', emoji: '🟡' };
  }
  if (score >= 55) {
    return { label: 'SPECULATIVE', text: 'Speculative', emoji: '🟠' };
  }
  return { label: 'LONG_SHOT', text: 'Long Shot (Not Recommended)', emoji: '🔴' };
}

// Map acceptance percentage to label
export function getAcceptanceLabel(acceptancePct: number): { rate: AcceptanceRate; text: string } {
  if (acceptancePct >= 60) {
    return { rate: 'HIGH', text: 'High' };
  }
  if (acceptancePct >= 40) {
    return { rate: 'MEDIUM', text: 'Medium' };
  }
  return { rate: 'LOW', text: 'Low' };
}

// Priority pill rules
export function getPriorityPill(
  score: number,
  hardRuleViolations: string[],
  cornerstoneRulesSatisfied: boolean,
  rosterFitScore: number
): { pill: PriorityPill; text: string } {
  // Only "High Priority" if ALL conditions met
  if (
    score >= 85 &&
    hardRuleViolations.length === 0 &&
    cornerstoneRulesSatisfied &&
    rosterFitScore >= 60
  ) {
    return { pill: 'HIGH_PRIORITY', text: 'High Priority — Act Fast' };
  }

  // Otherwise map by score
  if (score >= 70) {
    return { pill: 'AGGRESSIVE', text: 'Aggressive' };
  }
  if (score >= 55) {
    return { pill: 'SPECULATIVE', text: 'Speculative' };
  }
  return { pill: 'LONG_SHOT', text: 'Long Shot' };
}

// Generate all UI labels for a trade
export function generateUILabels(
  fairnessResult: HumanFairnessResult,
  hardRuleViolations: string[],
  cornerstoneRulesSatisfied: boolean
): UILabels {
  const display = getDisplayLabel(fairnessResult.final);
  
  // Estimate acceptance from fairness score (rough heuristic)
  const acceptancePct = Math.min(100, Math.max(0, fairnessResult.final + 10));
  const acceptance = getAcceptanceLabel(acceptancePct);
  
  const priority = getPriorityPill(
    fairnessResult.final,
    hardRuleViolations,
    cornerstoneRulesSatisfied,
    fairnessResult.breakdown.fit
  );

  return {
    displayLabel: display.label,
    displayText: display.text,
    displayEmoji: display.emoji,
    acceptanceRate: acceptance.rate,
    acceptanceText: acceptance.text,
    priorityPill: priority.pill,
    priorityText: priority.text
  };
}

// ============================================
// DYNAMIC THRESHOLD CALCULATION (from FantasyCalc)
// ============================================

export interface PositionPercentiles {
  p90: number;
  p95: number;
  p98: number;
}

export interface CalculatedThresholds {
  QB_CORNERSTONE_SF: number;
  QB_CORNERSTONE_1QB: number;
  TE_CORNERSTONE_TEP: number;
  TE_CORNERSTONE_STD: number;
  SKILL_CORNERSTONE: number;
}

// Calculate percentile from sorted values
function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.ceil((p / 100) * sortedValues.length) - 1;
  return sortedValues[Math.max(0, Math.min(index, sortedValues.length - 1))];
}

// Compute position percentiles from FantasyCalc data
export function computePositionPercentiles(
  players: Array<{ pos: string; value: number }>
): Record<string, PositionPercentiles> {
  const byPosition: Record<string, number[]> = {};

  // Group by position
  for (const p of players) {
    if (!byPosition[p.pos]) byPosition[p.pos] = [];
    byPosition[p.pos].push(p.value);
  }

  // Sort and compute percentiles
  const result: Record<string, PositionPercentiles> = {};
  for (const [pos, values] of Object.entries(byPosition)) {
    const sorted = values.sort((a, b) => a - b);
    result[pos] = {
      p90: percentile(sorted, 90),
      p95: percentile(sorted, 95),
      p98: percentile(sorted, 98)
    };
  }

  return result;
}

// Calculate thresholds dynamically from FantasyCalc data
export function calculateDynamicThresholds(
  percentiles: Record<string, PositionPercentiles>
): CalculatedThresholds {
  return {
    // Superflex: QB cornerstone = 92-95th percentile
    QB_CORNERSTONE_SF: percentiles['QB']?.p95 || DEFAULT_THRESHOLDS.QB_CORNERSTONE_SF,
    
    // 1QB: QB cornerstone = 97-98th percentile (only truly elite)
    QB_CORNERSTONE_1QB: percentiles['QB']?.p98 || DEFAULT_THRESHOLDS.QB_CORNERSTONE_1QB,
    
    // TEP: TE cornerstone = 93-95th percentile
    TE_CORNERSTONE_TEP: percentiles['TE']?.p95 || DEFAULT_THRESHOLDS.TE_CORNERSTONE_TEP,
    
    // non-TEP: TE cornerstone = 97-98th percentile
    TE_CORNERSTONE_STD: percentiles['TE']?.p98 || DEFAULT_THRESHOLDS.TE_CORNERSTONE_STD,
    
    // WR/RB: Use 95th percentile of combined skill positions
    SKILL_CORNERSTONE: Math.max(
      percentiles['WR']?.p95 || 0,
      percentiles['RB']?.p95 || 0
    ) || DEFAULT_THRESHOLDS.SKILL_CORNERSTONE
  };
}

// Build complete thresholds from FantasyCalc player data
export function buildThresholdsFromFantasyCalc(
  players: Array<{ pos: string; value: number }>
): Thresholds {
  const percentiles = computePositionPercentiles(players);
  const calculated = calculateDynamicThresholds(percentiles);
  
  return {
    ...calculated,
    EARLY_1ST_CORNERSTONE: true // Always true
  };
}

// ============================================
// TRADE PIPELINE (Order of Operations)
// ============================================
// 1. Add Asset shape + value map
// 2. Run cornerstone classifier
// 3. Generate candidate trades (2-for-1, 1-for-1, 2-for-2 only)
// 4. Hard filter (violatesHardRules)
// 5. Compute human fairness
// 6. Build deterministic explanations
// 7. (Optional) AI target teams
// 8. (Optional) AI restructure + risk writeups

export interface TradePipelineInput {
  userAssets: Asset[];
  targetManagerAssets: Asset[];
  league: LeagueSettings;
  userTeamId: string;
  targetTeamId: string;
  userFacts: TeamFacts;
  thresholds?: Thresholds;
  constraints?: Constraints;
}

export interface ValidatedTrade extends TradeCandidate {
  hardRuleResult: HardRuleResult;
  uiLabels: UILabels;
  cornerstoneRulesSatisfied: boolean;
}

export interface TradePipelineOutput {
  validTrades: ValidatedTrade[];
  rejectedTrades: Array<{ trade: Trade; reasons: string[] }>;
  thresholdsUsed: Thresholds;
}

// Step 1 & 2: Tag all assets with cornerstone flags
function prepareAssets(
  assets: Asset[],
  league: LeagueSettings,
  thresholds: Thresholds
): Asset[] {
  return assets.map(a => classifyCornerstone(a, league, thresholds));
}

// Step 3: Generate candidate trade structures (1-for-1, 2-for-1, 2-for-2)
type TradeStructure = '1-for-1' | '2-for-1' | '1-for-2' | '2-for-2';

function generateCandidateStructures(
  userAssets: Asset[],
  targetAssets: Asset[],
  constraints: Constraints
): Array<{ structure: TradeStructure; userGives: Asset[]; userGets: Asset[] }> {
  const candidates: Array<{ structure: TradeStructure; userGives: Asset[]; userGets: Asset[] }> = [];
  
  // Filter to tradeable assets only (exclude low value filler)
  const userTradeable = userAssets.filter(a => a.value >= constraints.noFillerMinValue);
  const targetTradeable = targetAssets.filter(a => a.value >= constraints.noFillerMinValue);

  // 1-for-1 trades
  for (const give of userTradeable) {
    for (const get of targetTradeable) {
      candidates.push({
        structure: '1-for-1',
        userGives: [give],
        userGets: [get]
      });
    }
  }

  // 2-for-1 trades (user consolidates)
  for (let i = 0; i < userTradeable.length; i++) {
    for (let j = i + 1; j < userTradeable.length; j++) {
      for (const get of targetTradeable) {
        candidates.push({
          structure: '2-for-1',
          userGives: [userTradeable[i], userTradeable[j]],
          userGets: [get]
        });
      }
    }
  }

  // 1-for-2 trades (user expands)
  for (const give of userTradeable) {
    for (let i = 0; i < targetTradeable.length; i++) {
      for (let j = i + 1; j < targetTradeable.length; j++) {
        candidates.push({
          structure: '1-for-2',
          userGives: [give],
          userGets: [targetTradeable[i], targetTradeable[j]]
        });
      }
    }
  }

  // 2-for-2 trades
  for (let i = 0; i < userTradeable.length; i++) {
    for (let j = i + 1; j < userTradeable.length; j++) {
      for (let k = 0; k < targetTradeable.length; k++) {
        for (let l = k + 1; l < targetTradeable.length; l++) {
          candidates.push({
            structure: '2-for-2',
            userGives: [userTradeable[i], userTradeable[j]],
            userGets: [targetTradeable[k], targetTradeable[l]]
          });
        }
      }
    }
  }

  return candidates;
}

// Main pipeline function
export function runTradePipeline(input: TradePipelineInput): TradePipelineOutput {
  const thresholds = input.thresholds || DEFAULT_THRESHOLDS;
  const constraints = input.constraints || DEFAULT_CONSTRAINTS;

  // Step 1 & 2: Prepare assets with cornerstone classification
  const userAssets = prepareAssets(input.userAssets, input.league, thresholds);
  const targetAssets = prepareAssets(input.targetManagerAssets, input.league, thresholds);

  // Step 3: Generate candidate trade structures
  const candidates = generateCandidateStructures(userAssets, targetAssets, constraints);

  const validTrades: ValidatedTrade[] = [];
  const rejectedTrades: Array<{ trade: Trade; reasons: string[] }> = [];

  for (const candidate of candidates) {
    const trade: Trade = {
      teamA_gives: candidate.userGives,
      teamA_gets: candidate.userGets
    };

    // Step 4: Hard filter
    const hardRuleResult = violatesHardRules(trade, input.league, constraints);
    
    if (!hardRuleResult.ok) {
      rejectedTrades.push({ trade, reasons: hardRuleResult.reasons });
      continue;
    }

    // Step 5: Compute human fairness
    const userContext: TeamRosterContext = {
      weakPositions: input.userFacts.teamNeeds[input.userTeamId] || []
    };
    const fairness = humanFairness(trade, userContext, hardRuleResult.reasons);

    // Skip trades with very low scores
    if (fairness.final < 40) {
      rejectedTrades.push({ trade, reasons: ['Fairness score too low'] });
      continue;
    }

    // Check cornerstone rules satisfied
    const givesCornerstone = trade.teamA_gives.some(a => a.isCornerstone);
    const getsCornerstone = trade.teamA_gets.some(a => a.isCornerstone);
    const givesTotal = sumValue(trade.teamA_gives);
    const getsTotal = sumValue(trade.teamA_gets);
    const ratio = getsTotal / Math.max(givesTotal, 1);
    
    let cornerstoneRulesSatisfied = true;
    if (givesCornerstone && !getsCornerstone) {
      // Must receive premium
      cornerstoneRulesSatisfied = ratio >= constraints.cornerstonePremiumMin;
    }

    // Step 6: Build deterministic explanations
    const whyUserAccepts = buildWhyTeamAccepts(
      input.userTeamId,
      { gets: candidate.userGets, gives: candidate.userGives },
      input.userFacts
    );
    const whyTargetAccepts = buildWhyTeamAccepts(
      input.targetTeamId,
      { gets: candidate.userGives, gives: candidate.userGets },
      input.userFacts
    );

    // Generate UI labels
    const uiLabels = generateUILabels(fairness, hardRuleResult.reasons, cornerstoneRulesSatisfied);

    // Build validated trade
    const validatedTrade: ValidatedTrade = {
      offer_id: `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      teamA_id: input.userTeamId,
      teamA_name: '', // Would be filled from league data
      teamB_id: input.targetTeamId,
      teamB_name: '',
      teamA_gives: candidate.userGives,
      teamA_gets: candidate.userGets,
      fairness,
      whyTeamAAccepts: whyUserAccepts,
      whyTeamBAccepts: whyTargetAccepts,
      hardRuleResult,
      uiLabels,
      cornerstoneRulesSatisfied
    };

    validTrades.push(validatedTrade);
  }

  // Sort by fairness score (best first)
  validTrades.sort((a, b) => b.fairness.final - a.fairness.final);

  return {
    validTrades: validTrades.slice(0, 20), // Top 20 trades
    rejectedTrades,
    thresholdsUsed: thresholds
  };
}

// ============================================
// CONFIGURABLE CORNERSTONE THRESHOLDS
// ============================================

export interface Thresholds {
  QB_CORNERSTONE_SF: number;      // SF QB threshold (QBs are gold in SF)
  QB_CORNERSTONE_1QB: number;     // 1QB QB threshold (only truly elite matter)
  TE_CORNERSTONE_TEP: number;     // TEP TE threshold (more TEs valuable)
  TE_CORNERSTONE_STD: number;     // Standard TE threshold (only elite)
  SKILL_CORNERSTONE: number;      // WR/RB threshold
  EARLY_1ST_CORNERSTONE: boolean; // Early 1sts are always cornerstone
}

// Default thresholds based on FantasyCalc value distributions
// Tune these with real distribution data
export const DEFAULT_THRESHOLDS: Thresholds = {
  QB_CORNERSTONE_SF: 7500,      // SF: QBs are gold (Mahomes, Allen, Hurts, Stroud, Lamar)
  QB_CORNERSTONE_1QB: 9500,     // 1QB: Only truly elite QBs matter
  TE_CORNERSTONE_TEP: 6500,     // TEP: More TEs have value, lower threshold
  TE_CORNERSTONE_STD: 8000,     // Standard: Only Kelce/Bowers tier
  SKILL_CORNERSTONE: 9000,      // WR/RB: Elite tier only (Jefferson, Chase, Bijan)
  EARLY_1ST_CORNERSTONE: true   // Early 1sts (1.01-1.04) always cornerstone
};

// Extended league settings for accurate detection
export interface LeagueSettings {
  superflex: boolean;
  tePremium: boolean;
  tePremiumMultiplier?: number; // e.g., 1.5 for 1.5 PPR TE
  startingQB?: number;          // Number of QB slots (for SF detection)
  format?: 'superflex' | '1qb' | 'standard';
}

// Helper: Detect if league is true Superflex
export function isSuperflex(league: LeagueSettings): boolean {
  return league.superflex || 
         league.format === 'superflex' || 
         (league.startingQB !== undefined && league.startingQB >= 2);
}

// Helper: Detect if league has meaningful TE Premium
export function isTEPremium(league: LeagueSettings): boolean {
  return league.tePremium && 
         (league.tePremiumMultiplier === undefined || league.tePremiumMultiplier >= 1.25);
}

// ============================================
// LEAGUE-LEVEL CONSTRAINTS
// ============================================

export interface Constraints {
  maxAssetsPerSide: number;           // 3 recommended
  allowFaab: boolean;                 // true
  faabMaxPercentOfTotal: number;      // 0.15 recommended (FAAB can only balance)
  cornerstonePremiumMin: number;      // 1.10
  cornerstonePremiumMax: number;      // 1.25 (cap to avoid suggesting overpays)
  baseFairnessMin: number;            // 0.92
  baseFairnessMax: number;            // 1.08
  rebuildFairnessMin: number;         // 0.90
  rebuildFairnessMax: number;         // 1.10
  noFillerMinValue: number;           // 800-1200 (tune)
  banOneForOneCornerstoneForNon: boolean; // true
}

export const DEFAULT_CONSTRAINTS: Constraints = {
  maxAssetsPerSide: 3,
  allowFaab: true,
  faabMaxPercentOfTotal: 0.15,
  cornerstonePremiumMin: 1.10,
  cornerstonePremiumMax: 1.25,
  baseFairnessMin: 0.92,
  baseFairnessMax: 1.08,
  rebuildFairnessMin: 0.90,
  rebuildFairnessMax: 1.10,
  noFillerMinValue: 1000,
  banOneForOneCornerstoneForNon: true
};

// ============================================
// HARD REJECT VALIDATION
// ============================================

export interface Trade {
  teamA_gives: Asset[];
  teamA_gets: Asset[];
}

export interface HardRuleResult {
  ok: boolean;
  reasons: string[];
}

function sumValue(assets: Asset[]): number {
  return assets.reduce((sum, a) => sum + a.value, 0);
}

export function violatesHardRules(
  trade: Trade,
  league: LeagueSettings,
  constraints: Constraints = DEFAULT_CONSTRAINTS
): HardRuleResult {
  const reasons: string[] = [];

  const aGives = trade.teamA_gives;
  const aGets = trade.teamA_gets;

  // Max assets per side
  if (aGives.length > constraints.maxAssetsPerSide) {
    reasons.push(`Too many assets on Team A side (${aGives.length} > ${constraints.maxAssetsPerSide}).`);
  }
  if (aGets.length > constraints.maxAssetsPerSide) {
    reasons.push(`Too many assets on Team B side (${aGets.length} > ${constraints.maxAssetsPerSide}).`);
  }

  // FAAB as anchor check
  const totalA = sumValue(aGives);
  const faabA = sumValue(aGives.filter(x => x.type === 'FAAB'));
  if (totalA > 0 && faabA / totalA > constraints.faabMaxPercentOfTotal) {
    reasons.push('FAAB too large relative to total; FAAB may only balance trades.');
  }

  // Also check receiving side FAAB
  const totalB = sumValue(aGets);
  const faabB = sumValue(aGets.filter(x => x.type === 'FAAB'));
  if (totalB > 0 && faabB / totalB > constraints.faabMaxPercentOfTotal) {
    reasons.push('FAAB too large on receiving side; FAAB may only balance trades.');
  }

  // One-for-one cornerstone swap check
  const givesCornerstone = aGives.some(x => x.isCornerstone);
  const getsCornerstone = aGets.some(x => x.isCornerstone);

  if (constraints.banOneForOneCornerstoneForNon) {
    if (aGives.length === 1 && aGets.length === 1) {
      const g = aGives[0];
      const r = aGets[0];
      if (g.isCornerstone && !r.isCornerstone) {
        reasons.push('Cornerstone-for-non-cornerstone 1-for-1 is not allowed.');
      }
      // Note: !g.isCornerstone && r.isCornerstone is handled by premium check below
    }
  }

  // Cornerstone premium requirement (if receiving cornerstone but not giving one)
  if (getsCornerstone && !givesCornerstone) {
    const givesTotal = sumValue(aGives);
    const getsTotal = sumValue(aGets);
    const ratio = getsTotal / Math.max(givesTotal, 1);
    
    if (ratio < constraints.cornerstonePremiumMin) {
      reasons.push(
        `Receiving a cornerstone requires premium >= ${constraints.cornerstonePremiumMin.toFixed(2)}x (got ${ratio.toFixed(2)}x).`
      );
    }
    if (ratio > constraints.cornerstonePremiumMax) {
      reasons.push(
        `Overpay cap exceeded (${ratio.toFixed(2)}x > ${constraints.cornerstonePremiumMax.toFixed(2)}x) to avoid bad advice.`
      );
    }
  }

  // Filler rule: no tiny assets unless they have purpose
  const lowValuePlayers = [...aGives, ...aGets].filter(
    x => x.type === 'PLAYER' && x.value < constraints.noFillerMinValue
  );
  if (lowValuePlayers.length > 0) {
    const names = lowValuePlayers.map(p => p.name || 'Unknown').join(', ');
    reasons.push(`Contains low-value filler assets (${names}). Trades must be clean and purposeful.`);
  }

  return { ok: reasons.length === 0, reasons };
}

// Legacy constants for backwards compatibility
export const QB_ELITE_THRESHOLD = DEFAULT_THRESHOLDS.QB_CORNERSTONE_SF;
export const TE_ELITE_THRESHOLD = DEFAULT_THRESHOLDS.TE_CORNERSTONE_STD;
export const SKILL_ELITE_THRESHOLD = DEFAULT_THRESHOLDS.SKILL_CORNERSTONE;
export const PICK_EARLY_1ST_THRESHOLD = 7000;

export type AssetClassification = 'CORNERSTONE' | 'STANDARD';

export interface LeagueSettingsForClassification {
  superflex: boolean;
  tePremium: boolean;
}

// ============================================
// UNIFIED ASSET TYPE
// ============================================

export type AssetType = 'PLAYER' | 'PICK' | 'FAAB';
export type PlayerPosition = 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DEF';
export type PickRound = 1 | 2 | 3 | 4;
export type PickProjection = 'early' | 'mid' | 'late' | 'unknown';

export interface Asset {
  id: string;
  type: AssetType;

  // For players
  name?: string;
  pos?: PlayerPosition;
  team?: string;

  // For picks
  pickSeason?: number;
  round?: PickRound;
  projected?: PickProjection;
  isOwnPick?: boolean;

  // For FAAB
  faabAmount?: number;

  // Value (FantasyCalc)
  value: number;

  // Derived flags
  tags?: string[];
  isCornerstone?: boolean;
  cornerstoneReason?: string;
}

// Legacy interface for backwards compatibility
export interface AssetForClassification {
  type: 'QB' | 'RB' | 'WR' | 'TE' | 'PICK' | 'FAAB';
  value: number;
  name?: string;
  round?: number;
  projected?: 'early' | 'mid' | 'late';
  cornerstone?: boolean;
}

// Convert new Asset to legacy format for existing functions
export function assetToClassification(asset: Asset, leagueSettings: LeagueSettingsForClassification): AssetForClassification {
  if (asset.type === 'PLAYER') {
    return {
      type: asset.pos as 'QB' | 'RB' | 'WR' | 'TE',
      value: asset.value,
      name: asset.name,
      cornerstone: asset.isCornerstone
    };
  }
  if (asset.type === 'PICK') {
    return {
      type: 'PICK',
      value: asset.value,
      round: asset.round,
      projected: asset.projected === 'unknown' ? undefined : asset.projected,
      cornerstone: asset.isCornerstone
    };
  }
  // FAAB
  return {
    type: 'FAAB',
    value: asset.faabAmount || asset.value,
    cornerstone: false
  };
}

// Compute cornerstone flag for an Asset
// Uses the user's classifier logic with proper league detection
export function computeCornerstone(
  asset: Asset, 
  league: LeagueSettings | LeagueSettingsForClassification,
  thresholds: Thresholds = DEFAULT_THRESHOLDS
): { isCornerstone: boolean; reason: string | undefined } {
  // FAAB is never cornerstone
  if (asset.type === 'FAAB') {
    return { isCornerstone: false, reason: undefined };
  }

  // PICK - only early 1sts are cornerstone
  if (asset.type === 'PICK') {
    if (asset.round === 1 && asset.projected === 'early' && thresholds.EARLY_1ST_CORNERSTONE) {
      return { isCornerstone: true, reason: 'Early 1st is a cornerstone pick (scarce, high upside).' };
    }
    return { isCornerstone: false, reason: undefined };
  }

  // PLAYER - detect league format
  const sf = 'format' in league ? isSuperflex(league as LeagueSettings) : league.superflex;
  const tep = 'tePremiumMultiplier' in league ? isTEPremium(league as LeagueSettings) : league.tePremium;

  // QB
  if (asset.pos === 'QB') {
    const threshold = sf ? thresholds.QB_CORNERSTONE_SF : thresholds.QB_CORNERSTONE_1QB;
    if (asset.value >= threshold) {
      const reason = sf ? 'Elite SF QB cornerstone.' : 'Elite 1QB QB cornerstone.';
      return { isCornerstone: true, reason };
    }
  }

  // TE
  if (asset.pos === 'TE') {
    const threshold = tep ? thresholds.TE_CORNERSTONE_TEP : thresholds.TE_CORNERSTONE_STD;
    if (asset.value >= threshold) {
      const reason = tep ? 'Elite TE in TE premium (positional edge).' : 'Elite TE cornerstone.';
      return { isCornerstone: true, reason };
    }
  }

  // WR/RB
  if ((asset.pos === 'WR' || asset.pos === 'RB') && asset.value >= thresholds.SKILL_CORNERSTONE) {
    return { isCornerstone: true, reason: 'Elite skill player cornerstone.' };
  }

  return { isCornerstone: false, reason: undefined };
}

// Tag an Asset with cornerstone flag
export function tagAssetCornerstone(
  asset: Asset, 
  league: LeagueSettings | LeagueSettingsForClassification,
  thresholds: Thresholds = DEFAULT_THRESHOLDS
): Asset {
  // If already explicitly set, don't override
  if (asset.isCornerstone !== undefined) {
    return asset;
  }
  
  const { isCornerstone, reason } = computeCornerstone(asset, league, thresholds);
  return {
    ...asset,
    isCornerstone,
    cornerstoneReason: reason
  };
}

// Tag all assets in an array
export function tagAllAssets(
  assets: Asset[],
  league: LeagueSettings | LeagueSettingsForClassification,
  thresholds: Thresholds = DEFAULT_THRESHOLDS
): Asset[] {
  return assets.map(a => tagAssetCornerstone(a, league, thresholds));
}

// Convenience: Classify cornerstone and return full Asset (matches user's classifyCornerstone)
export function classifyCornerstone(
  asset: Asset,
  league: LeagueSettings,
  thresholds: Thresholds = DEFAULT_THRESHOLDS
): Asset {
  const { isCornerstone, reason } = computeCornerstone(asset, league, thresholds);
  return {
    ...asset,
    isCornerstone,
    cornerstoneReason: reason || ''
  };
}

export function classifyAsset(
  asset: AssetForClassification, 
  leagueSettings: LeagueSettingsForClassification
): AssetClassification {
  // If cornerstone flag is explicitly set, use it
  if (asset.cornerstone !== undefined) {
    return asset.cornerstone ? 'CORNERSTONE' : 'STANDARD';
  }

  // Fallback: Calculate based on thresholds
  // QB in Superflex
  if (asset.type === 'QB' && leagueSettings.superflex) {
    return asset.value >= QB_ELITE_THRESHOLD ? 'CORNERSTONE' : 'STANDARD';
  }

  // TE (positional scarcity applies with or without premium)
  if (asset.type === 'TE') {
    return asset.value >= TE_ELITE_THRESHOLD ? 'CORNERSTONE' : 'STANDARD';
  }

  // WR or RB skill positions
  if (asset.type === 'WR' || asset.type === 'RB') {
    return asset.value >= SKILL_ELITE_THRESHOLD ? 'CORNERSTONE' : 'STANDARD';
  }

  // Draft picks
  if (asset.type === 'PICK') {
    if (asset.round === 1 && asset.projected === 'early') return 'CORNERSTONE';
    return 'STANDARD';
  }

  return 'STANDARD';
}

export function classifyTradeAssets(
  assets: AssetForClassification[],
  leagueSettings: LeagueSettingsForClassification
): { cornerstones: AssetForClassification[]; standard: AssetForClassification[] } {
  const cornerstones: AssetForClassification[] = [];
  const standard: AssetForClassification[] = [];
  
  for (const asset of assets) {
    if (classifyAsset(asset, leagueSettings) === 'CORNERSTONE') {
      cornerstones.push(asset);
    } else {
      standard.push(asset);
    }
  }
  
  return { cornerstones, standard };
}

// ============================================
// COMPOSITE FAIRNESS SCORING SYSTEM
// ============================================

export type FairnessLabel = 'STRONG' | 'FAIR_AGGRESSIVE' | 'SPECULATIVE' | 'UNLIKELY';

// Helper: clamp value between min and max
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// 3.1 Base ratio score
export function valueRatioScore(ratio: number): number {
  // ratio = (teamA_gets_total / teamA_gives_total)
  if (ratio >= 1.00 && ratio <= 1.05) return 100;
  if (ratio >= 0.95 && ratio < 1.00) return 85;
  if (ratio > 1.05 && ratio <= 1.10) return 85;
  if (ratio >= 0.92 && ratio < 0.95) return 70;
  if (ratio > 1.10 && ratio <= 1.15) return 70;
  return 50;
}

// 3.2 Scarcity / cornerstone modifier
export function scarcityScore(trade: Trade): number {
  const aGivesCornerstone = trade.teamA_gives.some(x => x.isCornerstone);
  const aGetsCornerstone = trade.teamA_gets.some(x => x.isCornerstone);

  let s = 50; // neutral

  if (aGetsCornerstone) s += 25;
  if (aGivesCornerstone) s -= 25;

  // Extra penalty if giving cornerstone without receiving one back
  if (aGivesCornerstone && !aGetsCornerstone) s -= 20;

  return clamp(s, 0, 100);
}

// 3.3 Roster fit score (facts only)
export interface TeamRosterContext {
  weakPositions: PlayerPosition[]; // Positions where team needs help
}

export function rosterFitScore(
  teamContext: TeamRosterContext,
  trade: Trade
): number {
  let score = 50;

  const needs = teamContext.weakPositions;
  const gainedPositions = trade.teamA_gets
    .filter(a => a.type === 'PLAYER')
    .map(a => a.pos)
    .filter((p): p is PlayerPosition => p !== undefined);
  const lostPositions = trade.teamA_gives
    .filter(a => a.type === 'PLAYER')
    .map(a => a.pos)
    .filter((p): p is PlayerPosition => p !== undefined);

  // +15 for each position gained that fills a need
  for (const p of gainedPositions) {
    if (needs.includes(p)) score += 15;
  }

  // -20 for each need position lost without replacement
  for (const p of lostPositions) {
    if (needs.includes(p) && !gainedPositions.includes(p)) {
      score -= 20;
    }
  }

  return clamp(score, 0, 100);
}

// 3.4 Market reality score (the "insult filter")
export function marketRealityScore(
  trade: Trade,
  hardRuleViolations: string[]
): number {
  let score = 75;

  // Major penalty for hard rule violations
  if (hardRuleViolations.length > 0) score -= 40;

  // Insult heuristic: asking for cornerstone while giving only 1 non-cornerstone
  const askCornerstone = trade.teamA_gets.some(x => x.isCornerstone);
  const offerNonCornerOnly = trade.teamA_gives.length === 1 && 
                              !trade.teamA_gives[0].isCornerstone;

  if (askCornerstone && offerNonCornerOnly) score -= 25;

  return clamp(score, 0, 100);
}

// 3.5 Final fairness score (the main entry point)
export interface HumanFairnessResult {
  final: number;
  label: FairnessLabel;
  recommendation: string;
  ratio: number;
  breakdown: {
    value: number;
    scarcity: number;
    fit: number;
    market: number;
  };
}

export function humanFairness(
  trade: Trade,
  teamContext: TeamRosterContext,
  hardRuleViolations: string[] = []
): HumanFairnessResult {
  const gives = sumValue(trade.teamA_gives);
  const gets = sumValue(trade.teamA_gets);
  const ratio = gets / Math.max(gives, 1);

  const v = valueRatioScore(ratio);
  const s = scarcityScore(trade);
  const f = rosterFitScore(teamContext, trade);
  const m = marketRealityScore(trade, hardRuleViolations);

  const final = Math.round(v * 0.40 + s * 0.25 + f * 0.20 + m * 0.15);

  // Map to labels
  let label: FairnessLabel;
  let recommendation: string;

  if (final >= 85) {
    label = 'STRONG';
    recommendation = 'Strong / Likely Accepted';
  } else if (final >= 70) {
    label = 'FAIR_AGGRESSIVE';
    recommendation = 'Fair but Aggressive';
  } else if (final >= 55) {
    label = 'SPECULATIVE';
    recommendation = 'Speculative';
  } else {
    label = 'UNLIKELY';
    recommendation = 'Unlikely / Do Not Recommend';
  }

  return {
    final,
    label,
    recommendation,
    ratio,
    breakdown: { value: v, scarcity: s, fit: f, market: m }
  };
}

// ============================================
// FACTS-BASED EXPLANATION SYSTEM
// ============================================
// Only use provable facts from roster/standings data

export type TeamDirection = 'CONTENDER' | 'MIDDLE' | 'REBUILD';

// Facts you can safely use (derived from data)
export interface TeamFacts {
  teamNeeds: Record<string, PlayerPosition[]>;     // Position needs per team ID
  teamDirection: Record<string, TeamDirection>;    // Win-now vs rebuild
  teamSurplus: Record<string, PlayerPosition[]>;   // Proven surplus positions
  teamRecord: Record<string, { wins: number; losses: number }>;
}

// Trade side for explanation building
export interface TradeSide {
  gets: Asset[];
  gives: Asset[];
}

// Build deterministic "why they accept" reasons
export function buildWhyTeamAccepts(
  teamId: string,
  tradeSide: TradeSide,
  facts: TeamFacts
): string[] {
  const reasons: string[] = [];

  // 1. Check if they receive a position they need
  const needs = facts.teamNeeds[teamId] || [];
  if (needs.length > 0) {
    const receivesPositions = tradeSide.gets
      .filter(a => a.type === 'PLAYER')
      .map(a => a.pos)
      .filter((p): p is PlayerPosition => p !== undefined);
    const matching = receivesPositions.filter(p => needs.includes(p));
    if (matching.length > 0) {
      const uniquePositions = [...new Set(matching)].join(', ');
      reasons.push(`Fills a need at ${uniquePositions} based on their starters/depth.`);
    }
  }

  // 2. Check if they're trading from a surplus position
  const surplus = facts.teamSurplus[teamId] || [];
  if (surplus.length > 0) {
    const givesPositions = tradeSide.gives
      .filter(a => a.type === 'PLAYER')
      .map(a => a.pos)
      .filter((p): p is PlayerPosition => p !== undefined);
    const tradingFromSurplus = givesPositions.filter(p => surplus.includes(p));
    if (tradingFromSurplus.length > 0) {
      const uniquePositions = [...new Set(tradingFromSurplus)].join(', ');
      reasons.push(`Trading from ${uniquePositions} surplus where they have depth.`);
    }
  }

  // 3. Check team direction alignment
  const direction = facts.teamDirection[teamId];
  
  if (direction === 'REBUILD') {
    const getsPicks = tradeSide.gets.some(a => a.type === 'PICK');
    const getsYoungPlayers = tradeSide.gets.some(a => 
      a.type === 'PLAYER' && a.tags?.includes('young')
    );
    if (getsPicks) {
      reasons.push('Aligns with rebuild plan by converting current value into future assets (picks).');
    } else if (getsYoungPlayers) {
      reasons.push('Acquires youth to build around during rebuild phase.');
    }
  }

  if (direction === 'CONTENDER') {
    const getsStarterLevel = tradeSide.gets.some(a => 
      a.type === 'PLAYER' && a.value >= 3000
    );
    if (getsStarterLevel) {
      reasons.push('Helps win-now by improving weekly starting lineup output.');
    }
    
    const givesPicks = tradeSide.gives.some(a => a.type === 'PICK');
    if (givesPicks) {
      reasons.push('Contender converting future picks into immediate production.');
    }
  }

  // 4. Check record context
  const record = facts.teamRecord[teamId];
  if (record) {
    const winPct = record.wins / Math.max(record.wins + record.losses, 1);
    if (winPct >= 0.6 && direction !== 'CONTENDER') {
      reasons.push(`Strong record (${record.wins}-${record.losses}) suggests pushing for playoffs.`);
    }
    if (winPct <= 0.4 && direction !== 'REBUILD') {
      reasons.push(`Struggling record (${record.wins}-${record.losses}) may warrant selling for future.`);
    }
  }

  // 5. Prevent empty - fallback
  if (reasons.length === 0) {
    reasons.push('Balances value while aligning with roster construction and team direction.');
  }

  // Return max 3 reasons
  return reasons.slice(0, 3);
}

// Convenience: Build facts from roster evidence
export function buildFactsFromEvidence(
  teamId: string,
  evidence: TeamEvidence
): Partial<TeamFacts> {
  const teamNeeds: Record<string, PlayerPosition[]> = {};
  const teamDirection: Record<string, TeamDirection> = {};
  const teamSurplus: Record<string, PlayerPosition[]> = {};
  const teamRecord: Record<string, { wins: number; losses: number }> = {};

  // Derive needs/surplus from roster evidence
  const { surplus, needs } = computeTeamNeeds(evidence.rosterEvidence);
  teamNeeds[teamId] = needs;
  teamSurplus[teamId] = surplus;
  teamDirection[teamId] = evidence.direction;
  
  if (evidence.record) {
    teamRecord[teamId] = evidence.record;
  }

  return { teamNeeds, teamDirection, teamSurplus, teamRecord };
}

export interface RosterEvidence {
  position: 'QB' | 'RB' | 'WR' | 'TE';
  startableCount: number;       // How many startable players at this position
  starterSlots: number;         // How many starter slots for this position
  playerNames?: string[];       // Names of startable players
}

export interface TeamEvidence {
  direction: TeamDirection;
  record?: { wins: number; losses: number };
  rosterEvidence: RosterEvidence[];
  hasSurplusAt: ('QB' | 'RB' | 'WR' | 'TE')[]; // Computed: startableCount > starterSlots
  hasNeedAt: ('QB' | 'RB' | 'WR' | 'TE')[];    // Computed: startableCount < starterSlots
}

export type RosterReason = 
  | { type: 'FILLS_STARTER_NEED'; position: string; currentStarters: number; slots: number }
  | { type: 'HAS_SURPLUS'; position: string; startableCount: number; slots: number; names: string[] }
  | { type: 'LACKS_DEPTH'; position: string; currentCount: number }
  | { type: 'STARTS_AT_POSITION'; position: string; rank: string }; // e.g., "WR3"

export type DirectionReason =
  | { type: 'REBUILDING_CONVERTING'; from: string; to: string } // "converting RB production into picks"
  | { type: 'CONTENDING_NEEDS_NOW'; position: string }
  | { type: 'MIDDLE_FLEXIBLE'; }; // Can go either way

export type MarketReason =
  | { type: 'POSITIONAL_SCARCITY'; position: string }
  | { type: 'PREMIUM_JUSTIFIED'; premium: number }
  | { type: 'YOUTH_DISCOUNT'; ageGap: number };

export interface TradeExplanation {
  whyTheyAccept: {
    rosterReason: RosterReason | null;
    directionReason: DirectionReason | null;
    marketReason: MarketReason | null;
  };
  provenFacts: string[];        // Human-readable proven statements
  unprovenClaims: string[];     // Claims that couldn't be verified (for debugging)
}

// Compute surplus/need from roster evidence
export function computeTeamNeeds(evidence: RosterEvidence[]): { 
  surplus: ('QB' | 'RB' | 'WR' | 'TE')[]; 
  needs: ('QB' | 'RB' | 'WR' | 'TE')[] 
} {
  const surplus: ('QB' | 'RB' | 'WR' | 'TE')[] = [];
  const needs: ('QB' | 'RB' | 'WR' | 'TE')[] = [];
  
  for (const pos of evidence) {
    if (pos.startableCount > pos.starterSlots) {
      surplus.push(pos.position);
    }
    if (pos.startableCount < pos.starterSlots) {
      needs.push(pos.position);
    }
  }
  
  return { surplus, needs };
}

// Generate explanation from evidence only
export function generateTradeExplanation(
  teamEvidence: TeamEvidence,
  receivingAssets: AssetForClassification[],
  givingAssets: AssetForClassification[]
): TradeExplanation {
  const provenFacts: string[] = [];
  const unprovenClaims: string[] = [];
  
  let rosterReason: RosterReason | null = null;
  let directionReason: DirectionReason | null = null;
  let marketReason: MarketReason | null = null;
  
  const { surplus, needs } = computeTeamNeeds(teamEvidence.rosterEvidence);
  
  // ============================================
  // 1. ROSTER-BASED REASON (from roster data)
  // ============================================
  
  // Check if receiving asset fills a need
  for (const asset of receivingAssets) {
    if (asset.type !== 'PICK' && asset.type !== 'FAAB') {
      const posEvidence = teamEvidence.rosterEvidence.find(r => r.position === asset.type);
      if (posEvidence && needs.includes(asset.type as any)) {
        rosterReason = {
          type: 'FILLS_STARTER_NEED',
          position: asset.type,
          currentStarters: posEvidence.startableCount,
          slots: posEvidence.starterSlots
        };
        provenFacts.push(
          `Team needs ${asset.type} (has ${posEvidence.startableCount} startable, needs ${posEvidence.starterSlots})`
        );
        break;
      }
    }
  }
  
  // Check if giving asset is from a surplus
  if (!rosterReason) {
    for (const asset of givingAssets) {
      if (asset.type !== 'PICK' && asset.type !== 'FAAB') {
        const posEvidence = teamEvidence.rosterEvidence.find(r => r.position === asset.type);
        if (posEvidence && surplus.includes(asset.type as any)) {
          rosterReason = {
            type: 'HAS_SURPLUS',
            position: asset.type,
            startableCount: posEvidence.startableCount,
            slots: posEvidence.starterSlots,
            names: posEvidence.playerNames || []
          };
          provenFacts.push(
            `Team has ${asset.type} surplus (${posEvidence.startableCount} startable, only ${posEvidence.starterSlots} slots)`
          );
          break;
        }
      }
    }
  }
  
  // ============================================
  // 2. DIRECTION-BASED REASON (from team phase)
  // ============================================
  
  if (teamEvidence.direction === 'REBUILD') {
    // Check if converting production into youth/picks
    const givingProduction = givingAssets.some(a => 
      (a.type === 'RB' || a.type === 'WR') && a.value >= 3000
    );
    const receivingYouthOrPicks = receivingAssets.some(a => 
      a.type === 'PICK' || (a.value >= 2000 && a.value < 5000)
    );
    
    if (givingProduction && receivingYouthOrPicks) {
      const fromPos = givingAssets.find(a => a.type === 'RB' || a.type === 'WR')?.type || 'production';
      directionReason = {
        type: 'REBUILDING_CONVERTING',
        from: `${fromPos} production`,
        to: 'youth/picks'
      };
      provenFacts.push(`Team is rebuilding and converting ${fromPos} production into youth/picks`);
    }
  } else if (teamEvidence.direction === 'CONTENDER') {
    // Check if receiving win-now asset
    const receivingWinNow = receivingAssets.find(a => 
      a.value >= 4000 && a.type !== 'PICK'
    );
    if (receivingWinNow) {
      directionReason = {
        type: 'CONTENDING_NEEDS_NOW',
        position: receivingWinNow.type
      };
      provenFacts.push(`Team is contending and needs ${receivingWinNow.type} production now`);
    }
  } else {
    directionReason = { type: 'MIDDLE_FLEXIBLE' };
    provenFacts.push('Team is in middle phase and can go either direction');
  }
  
  // ============================================
  // 3. MARKET-BASED REASON (optional)
  // ============================================
  
  // Elite TE or QB positional scarcity
  const receivingEliteTE = receivingAssets.find(a => 
    a.type === 'TE' && a.value >= TE_ELITE_THRESHOLD
  );
  const receivingEliteQB = receivingAssets.find(a => 
    a.type === 'QB' && a.value >= QB_ELITE_THRESHOLD
  );
  
  if (receivingEliteTE) {
    marketReason = { type: 'POSITIONAL_SCARCITY', position: 'TE' };
    provenFacts.push('Acquiring elite TE (positional scarcity premium applies)');
  } else if (receivingEliteQB) {
    marketReason = { type: 'POSITIONAL_SCARCITY', position: 'QB' };
    provenFacts.push('Acquiring elite QB (Superflex scarcity premium applies)');
  }
  
  return {
    whyTheyAccept: {
      rosterReason,
      directionReason,
      marketReason
    },
    provenFacts,
    unprovenClaims
  };
}

// Format explanation to human-readable string
export function formatExplanation(explanation: TradeExplanation): string {
  if (explanation.provenFacts.length === 0) {
    return 'No clear acceptance narrative based on available data.';
  }
  return explanation.provenFacts.join('. ') + '.';
}

export interface FairnessScoreResult {
  totalScore: number;
  label: FairnessLabel;
  breakdown: {
    valueRatioScore: number;
    positionalScarcityScore: number;
    rosterFitScore: number;
    marketRealityScore: number;
  };
  recommendation: string;
}

export interface RosterContext {
  startingNeeds: ('QB' | 'RB' | 'WR' | 'TE')[];  // Positions that would start
  luxuryPositions: ('QB' | 'RB' | 'WR' | 'TE')[]; // Already stacked, don't need
}

export function computeFairnessScore(
  givingAssets: AssetForClassification[],
  receivingAssets: AssetForClassification[],
  leagueSettings: LeagueSettingsForClassification,
  rosterContext?: RosterContext
): FairnessScoreResult {
  const givingTotal = givingAssets.reduce((sum, a) => sum + a.value, 0);
  const receivingTotal = receivingAssets.reduce((sum, a) => sum + a.value, 0);
  const ratio = givingTotal > 0 ? receivingTotal / givingTotal : 0;
  
  const givingClassified = classifyTradeAssets(givingAssets, leagueSettings);
  const receivingClassified = classifyTradeAssets(receivingAssets, leagueSettings);

  // ============================================
  // 1. VALUE RATIO SCORE (weight: 0.4)
  // ============================================
  let valueRatioScore: number;
  if (ratio >= 1.00 && ratio <= 1.05) {
    valueRatioScore = 100;
  } else if ((ratio >= 0.95 && ratio < 1.00) || (ratio > 1.05 && ratio <= 1.10)) {
    valueRatioScore = 85;
  } else if ((ratio >= 0.90 && ratio < 0.95) || (ratio > 1.10 && ratio <= 1.15)) {
    valueRatioScore = 70;
  } else if ((ratio >= 0.85 && ratio < 0.90) || (ratio > 1.15 && ratio <= 1.20)) {
    valueRatioScore = 55;
  } else {
    valueRatioScore = 40;
  }

  // ============================================
  // 2. POSITIONAL SCARCITY SCORE (weight: 0.25)
  // ============================================
  let positionalScarcityScore = 70; // Base score
  
  // Check if acquiring elite TE or SF QB
  const receivingEliteTE = receivingAssets.some(a => 
    a.type === 'TE' && a.value >= TE_ELITE_THRESHOLD
  );
  const receivingEliteQB = receivingAssets.some(a => 
    a.type === 'QB' && leagueSettings.superflex && a.value >= QB_ELITE_THRESHOLD
  );
  
  if (receivingEliteTE) positionalScarcityScore += 20;
  if (receivingEliteQB) positionalScarcityScore += 20;
  
  // Check if giving away elite TE or SF QB WITHOUT proper premium
  const givingEliteTE = givingAssets.some(a => 
    a.type === 'TE' && a.value >= TE_ELITE_THRESHOLD
  );
  const givingEliteQB = givingAssets.some(a => 
    a.type === 'QB' && leagueSettings.superflex && a.value >= QB_ELITE_THRESHOLD
  );
  
  if (givingEliteTE && !receivingEliteTE && ratio < 1.10) {
    positionalScarcityScore -= 30;
  }
  if (givingEliteQB && !receivingEliteQB && ratio < 1.10) {
    positionalScarcityScore -= 30;
  }
  
  // Clamp to 0-100
  positionalScarcityScore = Math.max(0, Math.min(100, positionalScarcityScore));

  // ============================================
  // 3. ROSTER FIT SCORE (weight: 0.2)
  // ============================================
  let rosterFitScore = 70; // Base score
  
  if (rosterContext) {
    // Points for filling starting lineup needs
    for (const asset of receivingAssets) {
      if (asset.type !== 'PICK' && asset.type !== 'FAAB') {
        if (rosterContext.startingNeeds.includes(asset.type as any)) {
          rosterFitScore += 15; // Fills a need
        }
        if (rosterContext.luxuryPositions.includes(asset.type as any)) {
          rosterFitScore -= 10; // Luxury swap, don't need
        }
      }
    }
    
    // Penalty for giving away positions you need
    for (const asset of givingAssets) {
      if (asset.type !== 'PICK' && asset.type !== 'FAAB') {
        if (rosterContext.startingNeeds.includes(asset.type as any)) {
          rosterFitScore -= 15; // Trading away a need
        }
      }
    }
  }
  
  // Clamp to 0-100
  rosterFitScore = Math.max(0, Math.min(100, rosterFitScore));

  // ============================================
  // 4. MARKET REALITY SCORE (weight: 0.15)
  // ============================================
  let marketRealityScore = 100; // Start perfect, deduct for violations
  
  // -40 if cornerstone rule violated
  if (givingClassified.cornerstones.length > 0 && receivingClassified.cornerstones.length === 0) {
    if (ratio < 1.10) {
      marketRealityScore -= 40; // Cornerstone underpaid
    }
  }
  
  // -40 if cornerstone 1-for-1 for non-cornerstone
  if (
    givingAssets.length === 1 && 
    receivingAssets.length === 1 &&
    givingClassified.cornerstones.length === 1 &&
    receivingClassified.cornerstones.length === 0
  ) {
    marketRealityScore -= 40;
  }
  
  // -20 "would insult manager" heuristic
  // Triggered when: giving starter, receiving bench-level assets
  const givingHasStarter = givingAssets.some(a => a.value >= 3000 && a.type !== 'PICK');
  const receivingAllLowValue = receivingAssets.every(a => a.value < 1500);
  if (givingHasStarter && receivingAllLowValue) {
    marketRealityScore -= 20;
  }
  
  // -20 if FAAB is largest asset on either side
  const givingFAABValue = givingAssets.filter(a => a.type === 'FAAB').reduce((sum, a) => sum + a.value, 0);
  const givingNonFAABValue = givingAssets.filter(a => a.type !== 'FAAB').reduce((sum, a) => sum + a.value, 0);
  const receivingFAABValue = receivingAssets.filter(a => a.type === 'FAAB').reduce((sum, a) => sum + a.value, 0);
  const receivingNonFAABValue = receivingAssets.filter(a => a.type !== 'FAAB').reduce((sum, a) => sum + a.value, 0);
  
  if ((givingFAABValue > givingNonFAABValue && givingFAABValue > 0) ||
      (receivingFAABValue > receivingNonFAABValue && receivingFAABValue > 0)) {
    marketRealityScore -= 20;
  }
  
  // Clamp to 0-100
  marketRealityScore = Math.max(0, Math.min(100, marketRealityScore));

  // ============================================
  // COMPOSITE SCORE CALCULATION
  // ============================================
  const totalScore = Math.round(
    valueRatioScore * 0.40 +
    positionalScarcityScore * 0.25 +
    rosterFitScore * 0.20 +
    marketRealityScore * 0.15
  );

  // ============================================
  // MAP TO LABELS
  // ============================================
  let label: FairnessLabel;
  let recommendation: string;
  
  if (totalScore >= 85) {
    label = 'STRONG';
    recommendation = 'Strong / Likely Accepted';
  } else if (totalScore >= 70) {
    label = 'FAIR_AGGRESSIVE';
    recommendation = 'Fair but Aggressive';
  } else if (totalScore >= 55) {
    label = 'SPECULATIVE';
    recommendation = 'Speculative';
  } else {
    label = 'UNLIKELY';
    recommendation = 'Unlikely / Do Not Recommend';
  }

  return {
    totalScore,
    label,
    breakdown: {
      valueRatioScore,
      positionalScarcityScore,
      rosterFitScore,
      marketRealityScore
    },
    recommendation
  };
}

// ============================================
// NON-NEGOTIABLE TRADE REJECTION RULES
// ============================================

export interface TradeRejection {
  rejected: boolean;
  reason: string;
  code: 'CORNERSTONE_1_FOR_1' | 'CORNERSTONE_UNDERPAID' | 'TOO_MANY_ASSETS' | 'FAAB_AS_ANCHOR' | null;
}

export function rejectTradeImmediately(
  givingAssets: AssetForClassification[],
  receivingAssets: AssetForClassification[],
  leagueSettings: LeagueSettingsForClassification
): TradeRejection {
  const givingClassified = classifyTradeAssets(givingAssets, leagueSettings);
  const receivingClassified = classifyTradeAssets(receivingAssets, leagueSettings);
  
  const givingTotal = givingAssets.reduce((sum, a) => sum + a.value, 0);
  const receivingTotal = receivingAssets.reduce((sum, a) => sum + a.value, 0);
  
  // ❌ RULE 1: Cornerstone traded 1-for-1 for non-cornerstone
  if (
    givingAssets.length === 1 && 
    receivingAssets.length === 1 &&
    givingClassified.cornerstones.length === 1 &&
    receivingClassified.cornerstones.length === 0
  ) {
    return {
      rejected: true,
      reason: `Cannot trade cornerstone ${givingAssets[0].name || givingAssets[0].type} 1-for-1 for non-cornerstone`,
      code: 'CORNERSTONE_1_FOR_1'
    };
  }
  
  // ❌ RULE 2: Cornerstone side receives < 110-125% value
  if (givingClassified.cornerstones.length > 0 && receivingClassified.cornerstones.length === 0) {
    const ratio = receivingTotal / givingTotal;
    if (ratio < 1.10) {
      return {
        rejected: true,
        reason: `Cornerstone trade requires 110-125% return. Got ${(ratio * 100).toFixed(0)}%`,
        code: 'CORNERSTONE_UNDERPAID'
      };
    }
  }
  
  // ❌ RULE 3: More than 3 assets per side
  if (givingAssets.length > 3) {
    return {
      rejected: true,
      reason: `Too many assets on giving side (${givingAssets.length}). Max 3 per side.`,
      code: 'TOO_MANY_ASSETS'
    };
  }
  if (receivingAssets.length > 3) {
    return {
      rejected: true,
      reason: `Too many assets on receiving side (${receivingAssets.length}). Max 3 per side.`,
      code: 'TOO_MANY_ASSETS'
    };
  }
  
  // ❌ RULE 4: FAAB used as primary value (can only balance, never anchor)
  const givingFAAB = givingAssets.filter(a => a.type === 'FAAB');
  const receivingFAAB = receivingAssets.filter(a => a.type === 'FAAB');
  const givingNonFAAB = givingAssets.filter(a => a.type !== 'FAAB');
  const receivingNonFAAB = receivingAssets.filter(a => a.type !== 'FAAB');
  
  // FAAB is anchor if it's the only asset or highest value asset
  if (givingFAAB.length > 0 && givingNonFAAB.length === 0) {
    return {
      rejected: true,
      reason: 'FAAB cannot be the primary asset in a trade (balance only)',
      code: 'FAAB_AS_ANCHOR'
    };
  }
  if (receivingFAAB.length > 0 && receivingNonFAAB.length === 0) {
    return {
      rejected: true,
      reason: 'FAAB cannot be the primary asset in a trade (balance only)',
      code: 'FAAB_AS_ANCHOR'
    };
  }
  
  // Check if FAAB is highest value on either side
  const givingFAABValue = givingFAAB.reduce((sum, a) => sum + a.value, 0);
  const givingNonFAABValue = givingNonFAAB.reduce((sum, a) => sum + a.value, 0);
  if (givingFAABValue > givingNonFAABValue && givingFAABValue > 0) {
    return {
      rejected: true,
      reason: 'FAAB cannot exceed player/pick value (balance only)',
      code: 'FAAB_AS_ANCHOR'
    };
  }
  
  const receivingFAABValue = receivingFAAB.reduce((sum, a) => sum + a.value, 0);
  const receivingNonFAABValue = receivingNonFAAB.reduce((sum, a) => sum + a.value, 0);
  if (receivingFAABValue > receivingNonFAABValue && receivingFAABValue > 0) {
    return {
      rejected: true,
      reason: 'FAAB cannot exceed player/pick value (balance only)',
      code: 'FAAB_AS_ANCHOR'
    };
  }
  
  // ✅ Trade passes all rejection rules
  return { rejected: false, reason: '', code: null };
}

export function validateCornerstoneTradeRatio(
  givingAssets: AssetForClassification[],
  receivingAssets: AssetForClassification[],
  leagueSettings: LeagueSettingsForClassification
): { isValid: boolean; ratio: number; message: string; hasCornerstoneViolation: boolean } {
  const givingClassified = classifyTradeAssets(givingAssets, leagueSettings);
  const receivingClassified = classifyTradeAssets(receivingAssets, leagueSettings);
  
  const givingTotal = givingAssets.reduce((sum, a) => sum + a.value, 0);
  const receivingTotal = receivingAssets.reduce((sum, a) => sum + a.value, 0);
  const ratio = receivingTotal / givingTotal;
  
  // If giving up cornerstone(s)
  if (givingClassified.cornerstones.length > 0) {
    // Check if receiving cornerstone(s) in return
    if (receivingClassified.cornerstones.length > 0) {
      // Cornerstone for cornerstone - use standard fairness band
      if (ratio >= 0.92 && ratio <= 1.08) {
        return { isValid: true, ratio, message: 'Cornerstone-for-cornerstone trade within fairness band', hasCornerstoneViolation: false };
      }
      return { isValid: false, ratio, message: `Cornerstone trade ratio ${ratio.toFixed(2)} outside 0.92-1.08 band`, hasCornerstoneViolation: true };
    }
    
    // Giving cornerstone but not receiving one - require 1.10-1.25 premium
    if (ratio < 1.10) {
      const cornerstoneNames = givingClassified.cornerstones.map(a => a.name || a.type).join(', ');
      return { 
        isValid: false, 
        ratio, 
        message: `CORNERSTONE_UNDERPAID: Trading ${cornerstoneNames} requires 1.10-1.25 ratio, got ${ratio.toFixed(2)}`,
        hasCornerstoneViolation: true
      };
    }
    if (ratio > 1.25) {
      return { 
        isValid: true, 
        ratio, 
        message: `Excellent premium for cornerstone (${ratio.toFixed(2)} ratio)`,
        hasCornerstoneViolation: false
      };
    }
    return { isValid: true, ratio, message: `Valid cornerstone premium (${ratio.toFixed(2)} ratio)`, hasCornerstoneViolation: false };
  }
  
  // No cornerstones involved - standard fairness band
  if (ratio >= 0.92 && ratio <= 1.08) {
    return { isValid: true, ratio, message: 'Trade within standard fairness band', hasCornerstoneViolation: false };
  }
  
  return { 
    isValid: false, 
    ratio, 
    message: `Trade ratio ${ratio.toFixed(2)} outside standard 0.92-1.08 band`,
    hasCornerstoneViolation: false
  };
}

export interface TradeConstraints {
  max_assets_per_side: number;
  no_filler_threshold_value: number;
  cornerstone_premium_required: number;
  fairness_band: { min: number; max: number };
  rebuild_fairness_band: { min: number; max: number };
  pick_ranges: {
    early: { min: 1; max: 4; value_multiplier: number };
    mid: { min: 5; max: 8; value_multiplier: number };
    late: { min: 9; max: 12; value_multiplier: number };
  };
  pick_round_base_values: {
    '1': { early: number; mid: number; late: number };
    '2': { early: number; mid: number; late: number };
    '3': { early: number; mid: number; late: number };
    '4': { early: number; mid: number; late: number };
  };
}

export const DEFAULT_TRADE_CONSTRAINTS: TradeConstraints = {
  max_assets_per_side: 3,
  no_filler_threshold_value: 800,
  cornerstone_premium_required: 0.15,
  fairness_band: { min: 0.92, max: 1.08 },
  rebuild_fairness_band: { min: 0.90, max: 1.10 },
  pick_ranges: {
    early: { min: 1, max: 4, value_multiplier: 1.25 },
    mid: { min: 5, max: 8, value_multiplier: 1.0 },
    late: { min: 9, max: 12, value_multiplier: 0.75 },
  },
  pick_round_base_values: {
    '1': { early: 8500, mid: 6500, late: 4500 },
    '2': { early: 3500, mid: 2800, late: 2000 },
    '3': { early: 1800, mid: 1400, late: 1000 },
    '4': { early: 900, mid: 700, late: 500 },
  },
};

export interface TradeableAsset {
  name: string;
  pos: string;
  value: number;
  reason?: string;
}

export interface RuntimeConstraints extends TradeConstraints {
  cornerstone_list_teamA: string[];
  cornerstone_list_teamB: string[];
  untouchables_teamA: string[];
  untouchables_teamB: string[];
  tradeable_assets_teamA: TradeableAsset[];
  tradeable_assets_teamB: TradeableAsset[];
}

export function getPickRange(slot: number | undefined): 'early' | 'mid' | 'late' {
  if (!slot) return 'mid';
  if (slot <= 4) return 'early';
  if (slot <= 8) return 'mid';
  return 'late';
}

export function getPickValueWithRange(
  round: number,
  slot: number | undefined,
  constraints: TradeConstraints = DEFAULT_TRADE_CONSTRAINTS
): number {
  const roundKey = String(round) as '1' | '2' | '3' | '4';
  const range = getPickRange(slot);
  const baseValues = constraints.pick_round_base_values[roundKey];
  
  if (!baseValues) {
    return round === 1 ? 5000 : round === 2 ? 2500 : round === 3 ? 1200 : 600;
  }
  
  return baseValues[range];
}

export function identifyCornerstones(
  roster: { name: string; pos: string }[],
  playerValues: Map<string, number> | Record<string, number>
): string[] {
  const cornerstones: string[] = [];
  
  for (const player of roster) {
    const nameLower = player.name.toLowerCase();
    // Tier 0/1 by `findPlayerTier`: exact name AND position group. A bare lowercase-name set made
    // LB Justin Jefferson a cornerstone and an untouchable (fixed 2026-10-12).
    const tiered = findPlayerTier(player.name, player.pos);
    if (tiered && tiered.tier <= 1) {
      cornerstones.push(player.name);
      continue;
    }
    
    const value = playerValues instanceof Map 
      ? playerValues.get(nameLower) 
      : playerValues[nameLower];
    if (value && value >= 7000) {
      cornerstones.push(player.name);
    }
  }
  
  return cornerstones;
}

export function identifyUntouchables(
  roster: { name: string; pos: string }[]
): string[] {
  return roster
    .filter(p => findPlayerTier(p.name, p.pos)?.tier === 0)
    .map(p => p.name);
}

export function isFillerAsset(
  value: number,
  constraints: TradeConstraints = DEFAULT_TRADE_CONSTRAINTS
): boolean {
  return value < constraints.no_filler_threshold_value;
}

export function validateTradeFairness(
  teamAGivesTotal: number,
  teamAGetsTotal: number,
  isRebuilding: boolean = false,
  constraints: TradeConstraints = DEFAULT_TRADE_CONSTRAINTS
): { isValid: boolean; ratio: number; message: string } {
  const ratio = teamAGetsTotal / teamAGivesTotal;
  const band = isRebuilding ? constraints.rebuild_fairness_band : constraints.fairness_band;
  
  if (ratio < band.min) {
    return {
      isValid: false,
      ratio,
      message: `Trade unfair - ratio ${ratio.toFixed(2)} is below minimum ${band.min}`
    };
  }
  
  if (ratio > band.max) {
    return {
      isValid: false,
      ratio,
      message: `Trade unfair - ratio ${ratio.toFixed(2)} is above maximum ${band.max}`
    };
  }
  
  return {
    isValid: true,
    ratio,
    message: 'Trade is within fairness band'
  };
}

export function validateCornerstoneProtection(
  assetsGiven: { name: string; value: number }[],
  assetsReceived: { name: string; value: number }[],
  cornerstones: string[],
  constraints: TradeConstraints = DEFAULT_TRADE_CONSTRAINTS
): { isValid: boolean; message: string } {
  const givenCornerstones = assetsGiven.filter(a => 
    cornerstones.some(c => c.toLowerCase() === a.name.toLowerCase())
  );
  
  if (givenCornerstones.length === 0) {
    return { isValid: true, message: 'No cornerstones being traded' };
  }
  
  const receivedCornerstones = assetsReceived.filter(a => 
    // No position on these assets, so exact normalized name only — never a substring.
    (findPlayerTier(a.name)?.tier ?? 99) <= 1
  );
  
  if (receivedCornerstones.length > 0) {
    return { isValid: true, message: 'Cornerstone-for-cornerstone trade' };
  }
  
  const givenValue = givenCornerstones.reduce((sum, a) => sum + a.value, 0);
  const receivedValue = assetsReceived.reduce((sum, a) => sum + a.value, 0);
  const requiredPremium = givenValue * (1 + constraints.cornerstone_premium_required);
  
  if (receivedValue >= requiredPremium) {
    return { isValid: true, message: `Premium of ${((receivedValue / givenValue - 1) * 100).toFixed(0)}% received` };
  }
  
  return {
    isValid: false,
    message: `Trading cornerstone without adequate return - need +${(constraints.cornerstone_premium_required * 100).toFixed(0)}% premium or another cornerstone`
  };
}

export function validateFillerAssets(
  assets: { name: string; value: number; pos?: string }[],
  starterNeeds: string[] = [],
  handcuffs: string[] = [],
  constraints: TradeConstraints = DEFAULT_TRADE_CONSTRAINTS
): { isValid: boolean; fillerCount: number; message: string } {
  const fillers = assets.filter(a => {
    if (a.value >= constraints.no_filler_threshold_value) return false;
    const posNeeded = starterNeeds.some(need => a.pos?.toUpperCase() === need.toUpperCase());
    const isHandcuff = handcuffs.some(h => h.toLowerCase() === a.name.toLowerCase());
    return !posNeeded && !isHandcuff;
  });
  
  if (fillers.length === 0) {
    return { isValid: true, fillerCount: 0, message: 'No filler assets' };
  }
  
  if (fillers.length === 1 && assets.length <= 3) {
    return { isValid: true, fillerCount: 1, message: 'Minor filler acceptable' };
  }
  
  return {
    isValid: false,
    fillerCount: fillers.length,
    message: `Trade includes ${fillers.length} filler asset(s) with no clear purpose: ${fillers.map(f => f.name).join(', ')}`
  };
}

export interface RosterPlayer {
  name: string;
  pos: string;
  slot?: string;
  isStarter?: boolean;
  isInjured?: boolean;
  value?: number;
}

export function buildTradeableAssets(
  roster: RosterPlayer[],
  playerValues: Map<string, number> | Record<string, number>,
  untouchables: string[],
  constraints: TradeConstraints = DEFAULT_TRADE_CONSTRAINTS
): TradeableAsset[] {
  const tradeable: TradeableAsset[] = [];
  const untouchableSet = new Set(untouchables.map(n => n.toLowerCase()));
  
  for (const player of roster) {
    const nameLower = player.name.toLowerCase();
    
    // Skip untouchables
    if (untouchableSet.has(nameLower)) {
      continue;
    }
    
    // Skip injured/IR players (dead assets)
    if (player.slot === 'IR' || player.isInjured) {
      continue;
    }
    
    // Get player value
    const value = playerValues instanceof Map 
      ? playerValues.get(nameLower) || 0
      : playerValues[nameLower] || 0;
    
    // Skip very low value players (below filler threshold and not a starter)
    if (value < constraints.no_filler_threshold_value && !player.isStarter) {
      continue;
    }
    
    tradeable.push({
      name: player.name,
      pos: player.pos,
      value,
      reason: player.isStarter ? 'starter' : value >= 7000 ? 'high_value' : 'depth'
    });
  }
  
  // Sort by value descending
  tradeable.sort((a, b) => b.value - a.value);
  
  return tradeable;
}

export function buildRuntimeConstraints(
  rosterA: RosterPlayer[],
  rosterB: RosterPlayer[],
  playerValues: Map<string, number> | Record<string, number>,
  overrides: Partial<TradeConstraints> = {}
): RuntimeConstraints {
  const constraints = { ...DEFAULT_TRADE_CONSTRAINTS, ...overrides };
  
  const untouchablesA = identifyUntouchables(rosterA);
  const untouchablesB = identifyUntouchables(rosterB);
  
  return {
    ...constraints,
    cornerstone_list_teamA: identifyCornerstones(rosterA, playerValues),
    cornerstone_list_teamB: identifyCornerstones(rosterB, playerValues),
    untouchables_teamA: untouchablesA,
    untouchables_teamB: untouchablesB,
    tradeable_assets_teamA: buildTradeableAssets(rosterA, playerValues, untouchablesA, constraints),
    tradeable_assets_teamB: buildTradeableAssets(rosterB, playerValues, untouchablesB, constraints),
  };
}

export function formatConstraintsForPrompt(constraints: RuntimeConstraints): string {
  return `
## RUNTIME TRADE CONSTRAINTS (HARD RULES - DO NOT BREAK)

### ASSET LIMITS
- max_assets_per_side: ${constraints.max_assets_per_side} (3 keeps it realistic; 4+ gets goofy fast)

### FILLER ASSET RULES
- no_filler_threshold_value: ${constraints.no_filler_threshold_value}
- RULE: Do NOT include assets below ${constraints.no_filler_threshold_value} value unless they are:
  - A handcuff to a star being traded
  - Filling a clear starter need for the receiving team

### CORNERSTONE ASSET PROTECTION (CRITICAL)
Some players are considered cornerstone assets due to positional scarcity and ceiling:
- Elite TEs (Kelce, Andrews, Bowers, LaPorta - generational prospects)
- Elite Superflex QBs (Mahomes, Allen, Hurts, Stroud, Caleb Williams)
- Truly elite, scarce positional advantages (top-3 at position with youth)

**cornerstone_list_teamA**: ${constraints.cornerstone_list_teamA.length > 0 ? constraints.cornerstone_list_teamA.join(', ') : 'None identified'}
**cornerstone_list_teamB**: ${constraints.cornerstone_list_teamB.length > 0 ? constraints.cornerstone_list_teamB.join(', ') : 'None identified'}
**untouchables_teamA**: ${constraints.untouchables_teamA.length > 0 ? constraints.untouchables_teamA.join(', ') : 'None'}
**untouchables_teamB**: ${constraints.untouchables_teamB.length > 0 ? constraints.untouchables_teamB.join(', ') : 'None'}

**CORNERSTONE TRADE RULES (HARD REQUIREMENTS):**
1. A 1-for-1 trade is NOT allowed unless the return is ALSO a cornerstone of similar tier
2. OR the side receiving the cornerstone must pay a premium of at least +15-25% FantasyCalc value
3. Premium must be MEANINGFUL (early 1st, elite player), NOT filler
4. NEVER propose a trade where a cornerstone is moved for a single non-cornerstone at a discount

**VALID cornerstone returns:**
- Another cornerstone (e.g., Kelce for Bowers + small add)
- Elite package: Early 1st + quality starter (e.g., 1.03 + Chris Olave)
- Multiple high-value assets totaling +20% premium

**INVALID cornerstone returns (REJECT THESE):**
- Single mid-tier player (e.g., NOT "Kelce for Kincaid straight up")
- Late picks + filler depth pieces
- "Value equivalent" that lacks cornerstone scarcity

### PICK VALUE RANGES (DO NOT TREAT "1st" AS GENERIC)
Draft picks MUST be valued based on their range:
| Round | Early (1-4) | Mid (5-8) | Late (9-12) |
|-------|-------------|-----------|-------------|
| 1st   | ${constraints.pick_round_base_values['1'].early} | ${constraints.pick_round_base_values['1'].mid} | ${constraints.pick_round_base_values['1'].late} |
| 2nd   | ${constraints.pick_round_base_values['2'].early} | ${constraints.pick_round_base_values['2'].mid} | ${constraints.pick_round_base_values['2'].late} |
| 3rd   | ${constraints.pick_round_base_values['3'].early} | ${constraints.pick_round_base_values['3'].mid} | ${constraints.pick_round_base_values['3'].late} |
| 4th   | ${constraints.pick_round_base_values['4'].early} | ${constraints.pick_round_base_values['4'].mid} | ${constraints.pick_round_base_values['4'].late} |

A "1.01" is worth nearly 2x a "1.12" - NEVER conflate these!

### FAIRNESS BAND
- Standard trades: ${constraints.fairness_band.min} to ${constraints.fairness_band.max}
- Rebuild trades: ${constraints.rebuild_fairness_band.min} to ${constraints.rebuild_fairness_band.max} (only when rebuilding team receives future value)
- ratio = teamA_gets_value / teamA_gives_value

**CORNERSTONE FAIRNESS OVERRIDE:**
Trades involving cornerstone assets have STRICTER requirements:
- The side GIVING UP the cornerstone must receive at least 1.10-1.25 value ratio
- This means they get 10-25% MORE value than what they're trading away
- If the cornerstone seller receives less than 1.10 ratio → TRADE IS INVALID
- Example: If you trade away Kelce (value 8000), you must receive at least 8800-10000 in return

### TRADEABLE ASSETS (MANDATORY - USE ONLY THESE)
**You may ONLY construct offers using assets found in tradeable_assets_teamA and tradeable_assets_teamB.**

**tradeable_assets_teamA** (${constraints.tradeable_assets_teamA.length} assets):
${constraints.tradeable_assets_teamA.length > 0 
  ? constraints.tradeable_assets_teamA.slice(0, 25).map(a => `- ${a.name} (${a.pos}) - Value: ${a.value}`).join('\n')
  : '- No tradeable assets identified'}

**tradeable_assets_teamB** (${constraints.tradeable_assets_teamB.length} assets):
${constraints.tradeable_assets_teamB.length > 0 
  ? constraints.tradeable_assets_teamB.slice(0, 25).map(a => `- ${a.name} (${a.pos}) - Value: ${a.value}`).join('\n')
  : '- No tradeable assets identified'}

CRITICAL: Do NOT suggest players that are not in these lists. Players excluded from lists are:
- Tier 0 untouchables (elite franchise players)
- Injured/IR players (dead assets with no trade value)
- Very low value players below ${constraints.no_filler_threshold_value} (roster cloggers)
`;
}
