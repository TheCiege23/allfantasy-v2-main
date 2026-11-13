import { findPlayerTier } from './dynasty-tiers';

// ============================================
// AI PROMPT TEMPLATES (Controlled AI Layer)
// ============================================
// AI can ONLY see candidate trades, values, needs, reasons, verdicts
// AI is FORBIDDEN from changing totals or proposing new values

// Trade candidate for AI layer
interface TradeCandidate {
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

// ============================================
// UI LABELS & DISPLAY SYSTEM
// ============================================

type DisplayLabel = 'STRONG' | 'FAIR_AGGRESSIVE' | 'SPECULATIVE' | 'LONG_SHOT';
type AcceptanceRate = 'HIGH' | 'MEDIUM' | 'LOW';
type PriorityPill = 'HIGH_PRIORITY' | 'AGGRESSIVE' | 'SPECULATIVE' | 'LONG_SHOT';

interface UILabels {
  displayLabel: DisplayLabel;
  displayText: string;
  displayEmoji: string;
  acceptanceRate: AcceptanceRate;
  acceptanceText: string;
  priorityPill: PriorityPill;
  priorityText: string;
}

// Map score to display label
function getDisplayLabel(score: number): { label: DisplayLabel; text: string; emoji: string } {
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
function getAcceptanceLabel(acceptancePct: number): { rate: AcceptanceRate; text: string } {
  if (acceptancePct >= 60) {
    return { rate: 'HIGH', text: 'High' };
  }
  if (acceptancePct >= 40) {
    return { rate: 'MEDIUM', text: 'Medium' };
  }
  return { rate: 'LOW', text: 'Low' };
}

// Priority pill rules
function getPriorityPill(
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

interface PositionPercentiles {
  p90: number;
  p95: number;
  p98: number;
}

interface CalculatedThresholds {
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

// ============================================
// TRADE PIPELINE (Order of Operations)
// ============================================
// 1. Add Asset shape + value map
// 2. Run cornerstone classifier
// 3. Generate candidate trades (2-for-1, 1-for-1, 2-for-2 only)
// 4. Hard filter
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

interface ValidatedTrade extends TradeCandidate {
  hardRuleResult: HardRuleResult;
  uiLabels: UILabels;
  cornerstoneRulesSatisfied: boolean;
}

export interface TradePipelineOutput {
  validTrades: ValidatedTrade[];
  rejectedTrades: Array<{ trade: Trade; reasons: string[] }>;
  thresholdsUsed: Thresholds;
}

// ============================================
// CONFIGURABLE CORNERSTONE THRESHOLDS
// ============================================

interface Thresholds {
  QB_CORNERSTONE_SF: number;      // SF QB threshold (QBs are gold in SF)
  QB_CORNERSTONE_1QB: number;     // 1QB QB threshold (only truly elite matter)
  TE_CORNERSTONE_TEP: number;     // TEP TE threshold (more TEs valuable)
  TE_CORNERSTONE_STD: number;     // Standard TE threshold (only elite)
  SKILL_CORNERSTONE: number;      // WR/RB threshold
  EARLY_1ST_CORNERSTONE: boolean; // Early 1sts are always cornerstone
}

// Default thresholds based on FantasyCalc value distributions
// Tune these with real distribution data
const DEFAULT_THRESHOLDS: Thresholds = {
  QB_CORNERSTONE_SF: 7500,      // SF: QBs are gold (Mahomes, Allen, Hurts, Stroud, Lamar)
  QB_CORNERSTONE_1QB: 9500,     // 1QB: Only truly elite QBs matter
  TE_CORNERSTONE_TEP: 6500,     // TEP: More TEs have value, lower threshold
  TE_CORNERSTONE_STD: 8000,     // Standard: Only Kelce/Bowers tier
  SKILL_CORNERSTONE: 9000,      // WR/RB: Elite tier only (Jefferson, Chase, Bijan)
  EARLY_1ST_CORNERSTONE: true   // Early 1sts (1.01-1.04) always cornerstone
};

// Extended league settings for accurate detection
interface LeagueSettings {
  superflex: boolean;
  tePremium: boolean;
  tePremiumMultiplier?: number; // e.g., 1.5 for 1.5 PPR TE
  startingQB?: number;          // Number of QB slots (for SF detection)
  format?: 'superflex' | '1qb' | 'standard';
}

// Helper: Detect if league is true Superflex
function isSuperflex(league: LeagueSettings): boolean {
  return league.superflex || 
         league.format === 'superflex' || 
         (league.startingQB !== undefined && league.startingQB >= 2);
}

// Helper: Detect if league has meaningful TE Premium
function isTEPremium(league: LeagueSettings): boolean {
  return league.tePremium && 
         (league.tePremiumMultiplier === undefined || league.tePremiumMultiplier >= 1.25);
}

// ============================================
// LEAGUE-LEVEL CONSTRAINTS
// ============================================

interface Constraints {
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

// ============================================
// HARD REJECT VALIDATION
// ============================================

interface Trade {
  teamA_gives: Asset[];
  teamA_gets: Asset[];
}

interface HardRuleResult {
  ok: boolean;
  reasons: string[];
}

function sumValue(assets: Asset[]): number {
  return assets.reduce((sum, a) => sum + a.value, 0);
}

// Legacy constants for backwards compatibility
const QB_ELITE_THRESHOLD = DEFAULT_THRESHOLDS.QB_CORNERSTONE_SF;
const TE_ELITE_THRESHOLD = DEFAULT_THRESHOLDS.TE_CORNERSTONE_STD;
const SKILL_ELITE_THRESHOLD = DEFAULT_THRESHOLDS.SKILL_CORNERSTONE;

type AssetClassification = 'CORNERSTONE' | 'STANDARD';

interface LeagueSettingsForClassification {
  superflex: boolean;
  tePremium: boolean;
}

// ============================================
// UNIFIED ASSET TYPE
// ============================================

type AssetType = 'PLAYER' | 'PICK' | 'FAAB';
type PlayerPosition = 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DEF';
type PickRound = 1 | 2 | 3 | 4;
type PickProjection = 'early' | 'mid' | 'late' | 'unknown';

interface Asset {
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
interface AssetForClassification {
  type: 'QB' | 'RB' | 'WR' | 'TE' | 'PICK' | 'FAAB';
  value: number;
  name?: string;
  round?: number;
  projected?: 'early' | 'mid' | 'late';
  cornerstone?: boolean;
}

// Compute cornerstone flag for an Asset
// Uses the user's classifier logic with proper league detection
function computeCornerstone(
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

function classifyAsset(
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

function classifyTradeAssets(
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

type FairnessLabel = 'STRONG' | 'FAIR_AGGRESSIVE' | 'SPECULATIVE' | 'UNLIKELY';

// Helper: clamp value between min and max
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// 3.1 Base ratio score
function valueRatioScore(ratio: number): number {
  // ratio = (teamA_gets_total / teamA_gives_total)
  if (ratio >= 1.00 && ratio <= 1.05) return 100;
  if (ratio >= 0.95 && ratio < 1.00) return 85;
  if (ratio > 1.05 && ratio <= 1.10) return 85;
  if (ratio >= 0.92 && ratio < 0.95) return 70;
  if (ratio > 1.10 && ratio <= 1.15) return 70;
  return 50;
}

// 3.2 Scarcity / cornerstone modifier
function scarcityScore(trade: Trade): number {
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
interface TeamRosterContext {
  weakPositions: PlayerPosition[]; // Positions where team needs help
}

function rosterFitScore(
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
function marketRealityScore(
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
interface HumanFairnessResult {
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

type TeamDirection = 'CONTENDER' | 'MIDDLE' | 'REBUILD';

// Facts you can safely use (derived from data)
interface TeamFacts {
  teamNeeds: Record<string, PlayerPosition[]>;     // Position needs per team ID
  teamDirection: Record<string, TeamDirection>;    // Win-now vs rebuild
  teamSurplus: Record<string, PlayerPosition[]>;   // Proven surplus positions
  teamRecord: Record<string, { wins: number; losses: number }>;
}

// Trade side for explanation building
interface TradeSide {
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

interface RosterEvidence {
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

type RosterReason = 
  | { type: 'FILLS_STARTER_NEED'; position: string; currentStarters: number; slots: number }
  | { type: 'HAS_SURPLUS'; position: string; startableCount: number; slots: number; names: string[] }
  | { type: 'LACKS_DEPTH'; position: string; currentCount: number }
  | { type: 'STARTS_AT_POSITION'; position: string; rank: string }; // e.g., "WR3"

type DirectionReason =
  | { type: 'REBUILDING_CONVERTING'; from: string; to: string } // "converting RB production into picks"
  | { type: 'CONTENDING_NEEDS_NOW'; position: string }
  | { type: 'MIDDLE_FLEXIBLE'; }; // Can go either way

type MarketReason =
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

interface FairnessScoreResult {
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

interface RosterContext {
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

interface TradeConstraints {
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

interface TradeableAsset {
  name: string;
  pos: string;
  value: number;
  reason?: string;
}

interface RuntimeConstraints extends TradeConstraints {
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

interface RosterPlayer {
  name: string;
  pos: string;
  slot?: string;
  isStarter?: boolean;
  isInjured?: boolean;
  value?: number;
}

function buildTradeableAssets(
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
