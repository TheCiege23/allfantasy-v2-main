import { pickRoundTable } from '@/lib/pick-curve';
export type AssetTier = 0 | 1 | 2 | 3 | 4;
export type SemanticTier = 'elite' | 'high' | 'starter' | 'replaceable' | 'depth';

export const TIER_TO_SEMANTIC: Record<AssetTier, SemanticTier> = {
  0: 'elite',
  1: 'high',
  2: 'starter',
  3: 'replaceable',
  4: 'depth',
};

export const SEMANTIC_TO_TIER: Record<SemanticTier, AssetTier> = {
  'elite': 0,
  'high': 1,
  'starter': 2,
  'replaceable': 3,
  'depth': 4,
};

export interface TieredPlayer {
  name: string;
  tier: AssetTier;
  semanticTier: SemanticTier;
  position: string;
  age?: number;
  notes?: string;
}

export const TIER_0_UNTOUCHABLES: TieredPlayer[] = [
  { name: "Puka Nacua", tier: 0, semanticTier: 'elite', position: "WR", age: 23 },
  { name: "Justin Jefferson", tier: 0, semanticTier: 'elite', position: "WR", age: 25 },
  { name: "Ja'Marr Chase", tier: 0, semanticTier: 'elite', position: "WR", age: 24 },
  { name: "CeeDee Lamb", tier: 0, semanticTier: 'elite', position: "WR", age: 25 },
  { name: "Marvin Harrison Jr.", tier: 0, semanticTier: 'elite', position: "WR", age: 22 },
  { name: "Marvin Harrison Jr", tier: 0, semanticTier: 'elite', position: "WR", age: 22 },
  { name: "MHJ", tier: 0, semanticTier: 'elite', position: "WR", age: 22 },
  { name: "Patrick Mahomes", tier: 0, semanticTier: 'elite', position: "QB", age: 29, notes: "SF only" },
  { name: "Josh Allen", tier: 0, semanticTier: 'elite', position: "QB", age: 28, notes: "SF only" },
  { name: "Lamar Jackson", tier: 0, semanticTier: 'elite', position: "QB", age: 28, notes: "SF only" },
  { name: "Jalen Hurts", tier: 0, semanticTier: 'elite', position: "QB", age: 26, notes: "SF only" },
];

export const TIER_1_CORNERSTONES: TieredPlayer[] = [
  { name: "Amon-Ra St. Brown", tier: 1, semanticTier: 'high', position: "WR", age: 25 },
  { name: "A.J. Brown", tier: 1, semanticTier: 'high', position: "WR", age: 27 },
  { name: "Tyreek Hill", tier: 1, semanticTier: 'high', position: "WR", age: 30 },
  { name: "Garrett Wilson", tier: 1, semanticTier: 'high', position: "WR", age: 24 },
  { name: "Chris Olave", tier: 1, semanticTier: 'high', position: "WR", age: 24 },
  { name: "Drake London", tier: 1, semanticTier: 'high', position: "WR", age: 23 },
  { name: "Bijan Robinson", tier: 1, semanticTier: 'high', position: "RB", age: 22 },
  { name: "Breece Hall", tier: 1, semanticTier: 'high', position: "RB", age: 23 },
  { name: "C.J. Stroud", tier: 1, semanticTier: 'high', position: "QB", age: 23 },
  { name: "Caleb Williams", tier: 1, semanticTier: 'high', position: "QB", age: 23 },
  { name: "Jayden Daniels", tier: 1, semanticTier: 'high', position: "QB", age: 24 },
  { name: "Anthony Richardson", tier: 1, semanticTier: 'high', position: "QB", age: 22 },
];

export const TIER_2_HIGH_END: TieredPlayer[] = [
  { name: "DK Metcalf", tier: 2, semanticTier: 'starter', position: "WR", age: 27 },
  { name: "Jaxon Smith-Njigba", tier: 2, semanticTier: 'starter', position: "WR", age: 22 },
  { name: "JSN", tier: 2, semanticTier: 'starter', position: "WR", age: 22 },
  { name: "Rome Odunze", tier: 2, semanticTier: 'starter', position: "WR", age: 22 },
  { name: "Malik Nabers", tier: 2, semanticTier: 'starter', position: "WR", age: 21 },
  { name: "Travis Kelce", tier: 2, semanticTier: 'starter', position: "TE", age: 35 },
  { name: "Sam LaPorta", tier: 2, semanticTier: 'starter', position: "TE", age: 23 },
  { name: "Trey McBride", tier: 2, semanticTier: 'starter', position: "TE", age: 25 },
  { name: "Brock Bowers", tier: 2, semanticTier: 'starter', position: "TE", age: 22 },
  { name: "Joe Burrow", tier: 2, semanticTier: 'starter', position: "QB", age: 28 },
  { name: "Dak Prescott", tier: 2, semanticTier: 'starter', position: "QB", age: 31 },
  { name: "Jordan Love", tier: 2, semanticTier: 'starter', position: "QB", age: 26 },
  { name: "Jahmyr Gibbs", tier: 2, semanticTier: 'starter', position: "RB", age: 22 },
  { name: "Jonathan Taylor", tier: 2, semanticTier: 'starter', position: "RB", age: 25 },
];

export const TIER_3_STARTERS: TieredPlayer[] = [
  { name: "De'Von Achane", tier: 3, semanticTier: 'replaceable', position: "RB", age: 23 },
  { name: "Kyren Williams", tier: 3, semanticTier: 'replaceable', position: "RB", age: 24 },
  { name: "Kenneth Walker III", tier: 3, semanticTier: 'replaceable', position: "RB", age: 24 },
  { name: "Isiah Pacheco", tier: 3, semanticTier: 'replaceable', position: "RB", age: 25 },
  { name: "Terry McLaurin", tier: 3, semanticTier: 'replaceable', position: "WR", age: 29 },
  { name: "DeVonta Smith", tier: 3, semanticTier: 'replaceable', position: "WR", age: 26 },
  { name: "Nico Collins", tier: 3, semanticTier: 'replaceable', position: "WR", age: 26 },
  { name: "Tee Higgins", tier: 3, semanticTier: 'replaceable', position: "WR", age: 26 },
  { name: "Tank Dell", tier: 3, semanticTier: 'replaceable', position: "WR", age: 25 },
  { name: "George Pickens", tier: 3, semanticTier: 'replaceable', position: "WR", age: 24 },
  { name: "Rashee Rice", tier: 3, semanticTier: 'replaceable', position: "WR", age: 24 },
  { name: "Ladd McConkey", tier: 3, semanticTier: 'replaceable', position: "WR", age: 23 },
  { name: "Keenan Allen", tier: 3, semanticTier: 'replaceable', position: "WR", age: 33 },
  { name: "Davante Adams", tier: 3, semanticTier: 'replaceable', position: "WR", age: 32 },
  { name: "Kyle Pitts", tier: 3, semanticTier: 'replaceable', position: "TE", age: 24 },
  { name: "Dalton Kincaid", tier: 3, semanticTier: 'replaceable', position: "TE", age: 25 },
  { name: "Mark Andrews", tier: 3, semanticTier: 'replaceable', position: "TE", age: 29 },
];

export const TIER_4_REPLACEABLE: TieredPlayer[] = [
  { name: "Alvin Kamara", tier: 4, semanticTier: 'depth', position: "RB", age: 29, notes: "aging" },
  { name: "Derrick Henry", tier: 4, semanticTier: 'depth', position: "RB", age: 31, notes: "aging" },
  { name: "Deebo Samuel", tier: 4, semanticTier: 'depth', position: "WR", age: 29, notes: "aging" },
  { name: "Stefon Diggs", tier: 4, semanticTier: 'depth', position: "WR", age: 31, notes: "aging" },
  { name: "Mike Evans", tier: 4, semanticTier: 'depth', position: "WR", age: 31, notes: "aging" },
  { name: "Travis Etienne", tier: 4, semanticTier: 'depth', position: "RB", age: 25 },
  { name: "Rachaad White", tier: 4, semanticTier: 'depth', position: "RB", age: 25 },
  { name: "Josh Jacobs", tier: 4, semanticTier: 'depth', position: "RB", age: 27, notes: "aging" },
  { name: "Aaron Jones", tier: 4, semanticTier: 'depth', position: "RB", age: 30, notes: "aging" },
  { name: "D'Andre Swift", tier: 4, semanticTier: 'depth', position: "RB", age: 26 },
  { name: "David Njoku", tier: 4, semanticTier: 'depth', position: "TE", age: 28 },
  { name: "Pat Freiermuth", tier: 4, semanticTier: 'depth', position: "TE", age: 26 },
  { name: "Jonnu Smith", tier: 4, semanticTier: 'depth', position: "TE", age: 29 },
];

export const ALL_TIERED_PLAYERS = [
  ...TIER_0_UNTOUCHABLES,
  ...TIER_1_CORNERSTONES,
  ...TIER_2_HIGH_END,
  ...TIER_3_STARTERS,
  ...TIER_4_REPLACEABLE,
];

export const TIER_BASE_VALUES: Record<AssetTier, number> = {
  0: 950,
  1: 775,
  2: 625,
  3: 475,
  4: 300,
};

/**
 * ⚠ THE SHAPE CHANGED HERE, AND IT IS THE BIGGEST MOVE OF THE COLLAPSE. This curve was the
 * steepest of the five — a second round at 0.277 of a first where the canonical shape pays
 * 0.48, and a third at 0.108 against 0.24. Measured against 771 real dynasty trades it fit
 * worse than the shape now used, so mid-round picks were being under-priced here relative to
 * every other surface. The first-round anchor of 650 is this module's own scale and is
 * untouched.
 */
export const PICK_BASE_VALUES: Record<number, number> = pickRoundTable(650, 4);

export const PICK_SLOT_MODIFIERS: Record<string, number> = {
  'early': 1.35,
  'mid': 1.00,
  'late': 0.70,
};

export const PICK_TIME_DISCOUNT: Record<number, number> = {
  0: 1.00,
  1: 0.85,
  2: 0.70,
  3: 0.55,
};

export const PICK_SPECIFIC_SLOT_VALUES: Record<string, number> = {
  '1.01': 950,
  '1.02': 900,
  '1.03': 850,
  '1.04': 800,
  '1.05': 750,
  '1.06': 700,
  '1.07': 650,
  '1.08': 600,
  '1.09': 550,
  '1.10': 500,
  '1.11': 450,
  '1.12': 400,
  '2.01': 300,
  '2.02': 275,
  '2.03': 250,
  '2.04': 225,
  '2.05': 200,
  '2.06': 180,
  '2.07': 160,
  '2.08': 140,
  '2.09': 125,
  '2.10': 110,
  '2.11': 100,
  '2.12': 90,
  '3.01': 80,
  '3.02': 75,
  '3.03': 70,
  '3.04': 65,
  '3.05': 60,
  '3.06': 55,
};

export function getAgeCurveModifier(position: string, age: number | undefined): number {
  if (!age) return 0;
  
  const pos = position.toUpperCase();
  
  if (pos === 'RB') {
    if (age <= 24) return 0.08;
    if (age === 25) return 0;
    if (age === 26) return -0.08;
    if (age === 27) return -0.15;
    return -0.25;
  }
  
  if (pos === 'WR') {
    if (age <= 24) return 0.08;
    if (age >= 25 && age <= 27) return 0;
    if (age >= 28 && age <= 29) return -0.08;
    return -0.18;
  }
  
  if (pos === 'TE') {
    if (age <= 25) return 0.05;
    if (age >= 26 && age <= 29) return 0;
    if (age >= 30 && age <= 31) return -0.08;
    return -0.15;
  }
  
  if (pos === 'QB') {
    if (age <= 25) return 0.05;
    if (age >= 26 && age <= 32) return 0;
    if (age >= 33 && age <= 35) return -0.08;
    return -0.15;
  }
  
  return 0;
}

// NEW: Dynasty Value Formula - Window Calculation
export function getExpectedWindow(position: string, age: number | undefined): number {
  if (!age) return 5; // Default
  const pos = position.toUpperCase();
  
  if (pos === 'QB') {
    // QB window: 8-12 years, starts declining after 34
    const yearsLeft = Math.max(0, 38 - age);
    return Math.min(12, Math.max(1, yearsLeft));
  }
  
  if (pos === 'WR') {
    // WR window: 6-8 years, starts declining after 30
    const yearsLeft = Math.max(0, 32 - age);
    return Math.min(8, Math.max(1, yearsLeft));
  }
  
  if (pos === 'TE') {
    // TE window: 6-8 years, starts declining after 31
    const yearsLeft = Math.max(0, 33 - age);
    return Math.min(8, Math.max(1, yearsLeft));
  }
  
  if (pos === 'RB') {
    // RB window: 2-3 years MAX - this is the key differentiator
    if (age <= 23) return 4;
    if (age <= 24) return 3;
    if (age <= 25) return 2.5;
    if (age <= 26) return 2;
    if (age <= 27) return 1.5;
    if (age <= 28) return 1;
    return 0.5; // 29+: half a year of relevant value
  }
  
  return 4;
}

// NEW: Window Multiplier (sqrt of years prevents RBs from competing with QBs)
export function getWindowMultiplier(window: number): number {
  return Math.sqrt(Math.max(0.5, window));
}

// NEW: Position Multiplier (SF-aware)
export function getPositionMultiplier(position: string, isSF: boolean, isTEP: boolean): number {
  const pos = position.toUpperCase();
  
  if (pos === 'QB') {
    return isSF ? 1.65 : 0.90; // 1.55-1.75 in SF, reduced in 1QB
  }
  
  if (pos === 'WR') {
    return 1.20;
  }
  
  if (pos === 'TE') {
    return isTEP ? 1.35 : 1.15;
  }
  
  if (pos === 'RB') {
    return 0.90; // 0.85-1.00, RBs are only position that can go <1.0
  }
  
  return 1.0;
}

// NEW: Liquidity Bonus (how easy to flip in 6 months)
export function getLiquidityModifier(position: string, age: number | undefined, tier: AssetTier | null): number {
  if (!age) return 0;
  const pos = position.toUpperCase();
  
  // Young QBs are extremely liquid
  if (pos === 'QB' && age <= 26 && tier !== null && tier <= 1) {
    return 0.15;
  }
  
  // Young WRs are very liquid
  if (pos === 'WR' && age <= 25 && tier !== null && tier <= 2) {
    return 0.10;
  }
  
  // Elite TEs are liquid
  if (pos === 'TE' && tier !== null && tier <= 2) {
    return 0.08;
  }
  
  // RBs over 28 are illiquid (hard to move)
  if (pos === 'RB' && age >= 28) {
    return -0.15;
  }
  
  // RBs 27 are starting to lose liquidity
  if (pos === 'RB' && age === 27) {
    return -0.08;
  }
  
  return 0;
}

// NEW: Age Curve with CLIFFS (non-linear, position-specific)
export function getAgeCurveWithCliffs(position: string, age: number | undefined): number {
  if (!age) return 1.0;
  const pos = position.toUpperCase();
  
  if (pos === 'RB') {
    // RB cliff system - steep drops
    if (age <= 25) return 1.00;
    if (age <= 27) return 0.95;
    if (age === 28) return 0.85; // CLIFF
    if (age === 29) return 0.70; // STEEP CLIFF
    return 0.55; // 30+: severely devalued
  }
  
  if (pos === 'QB') {
    if (age <= 26) return 1.10; // Young premium
    if (age <= 30) return 1.00;
    if (age <= 33) return 0.95;
    if (age <= 36) return 0.85;
    return 0.70; // 37+
  }
  
  if (pos === 'WR') {
    if (age <= 24) return 1.08;
    if (age <= 27) return 1.00;
    if (age <= 29) return 0.92;
    if (age <= 31) return 0.80;
    return 0.65; // 32+
  }
  
  if (pos === 'TE') {
    if (age <= 25) return 1.05;
    if (age <= 28) return 1.00;
    if (age <= 30) return 0.90;
    if (age <= 32) return 0.80;
    return 0.65; // 33+
  }
  
  return 1.0;
}

// NEW: Calculate Dynasty Score using the full formula
export function calculateDynastyScore(
  baseValue: number,
  position: string,
  age: number | undefined,
  tier: AssetTier | null,
  isSF: boolean,
  isTEP: boolean
): { score: number; window: number; breakdown: { position: number; age: number; window: number; liquidity: number } } {
  const positionMultiplier = getPositionMultiplier(position, isSF, isTEP);
  const ageCurve = getAgeCurveWithCliffs(position, age);
  const window = getExpectedWindow(position, age);
  const windowMultiplier = getWindowMultiplier(window);
  const liquidityModifier = getLiquidityModifier(position, age, tier);
  
  const score = baseValue * positionMultiplier * ageCurve * windowMultiplier * (1 + liquidityModifier);
  
  return {
    score: Math.round(score),
    window,
    breakdown: {
      position: positionMultiplier,
      age: ageCurve,
      window: windowMultiplier,
      liquidity: 1 + liquidityModifier,
    }
  };
}

export function getFormatModifier(
  position: string,
  tier: AssetTier,
  isSF: boolean,
  isTEP: boolean
): number {
  const pos = position.toUpperCase();
  
  let modifier = 1.0;
  
  if (pos === 'QB') {
    modifier *= isSF ? 1.25 : 0.85;
  }
  
  if (pos === 'TE' && isTEP && tier <= 2) {
    modifier *= 1.15;
  }
  
  if (pos === 'WR' && tier <= 1) {
    modifier *= 1.10;
  }
  
  if (pos === 'RB') {
    modifier *= 0.85;
  }
  
  return modifier;
}

export function getIDPMultiplier(idpStarterCount: number): number {
  if (idpStarterCount === 0) return 0.05;
  if (idpStarterCount <= 3) return 0.20;
  if (idpStarterCount <= 6) return 0.30;
  if (idpStarterCount <= 9) return 0.40;
  return 0.55;
}

export function isIDPPosition(position: string): boolean {
  const idpPositions = ['LB', 'DB', 'DL', 'DE', 'DT', 'S', 'CB', 'IDP', 'ED', 'EDGE'];
  return idpPositions.includes(position.toUpperCase());
}

export function findPlayerTier(playerName: string): TieredPlayer | null {
  const normalized = playerName.toLowerCase().trim();
  return ALL_TIERED_PLAYERS.find(p => 
    p.name.toLowerCase() === normalized ||
    p.name.toLowerCase().includes(normalized) ||
    normalized.includes(p.name.toLowerCase())
  ) || null;
}

export interface TradeAsset {
  name: string;
  position?: string;
  age?: number;
  isPick?: boolean;
  pickYear?: number;
  pickRound?: number;
  pickSlot?: 'early' | 'mid' | 'late';
  pickNumber?: number;
  pickType?: string;
}

export interface EvaluatedAsset extends TradeAsset {
  tier: AssetTier | null;
  baseValue: number;
  ageCurveModifier: number;
  formatModifier: number;
  adjustedValue: number;
  isIDP: boolean;
  isAging: boolean;
}

export interface LeagueSettings {
  isSF: boolean;
  isTEP: boolean;
  idpStarterCount: number;
}

export interface TradeEvaluation {
  senderAssets: EvaluatedAsset[];
  receiverAssets: EvaluatedAsset[];
  senderTotalValue: number;
  receiverTotalValue: number;
  deltaPct: number;
  valueRatio: number;
  tierViolation: boolean;
  tierViolationReason: string | null;
  tierParityCheck: {
    passed: boolean;
    senderBestTier: SemanticTier | null;
    receiverBestTier: SemanticTier | null;
    violation: string | null;
  };
  timelineCheck: {
    senderTimeline: 'contender' | 'rebuild' | 'middle';
    receiverTimeline: 'contender' | 'rebuild' | 'middle';
    aligned: boolean;
    mismatchReason: string | null;
  };
  sanityCheck: {
    wouldMostReject: boolean;
    rejectReason: string | null;
    rejectionRate: number;
    windowMismatch: boolean;
    windowMismatchYears: number;
    qbRbVeto: boolean;
    asymmetricValue: boolean;
  };
  windowAnalysis: {
    senderAvgWindow: number;
    receiverAvgWindow: number;
    windowDelta: number;
    dynastyVerdict: 'LONG_TERM_WIN' | 'SHORT_TERM_WIN' | 'BALANCED' | 'ASYMMETRIC';
    dynastyLabel: string;
  };
  plausibility: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNREALISTIC';
  maxGrade: string;
  verdict: 'FAIR' | 'SLIGHT_EDGE' | 'LOPSIDED' | 'VERY_LOPSIDED' | 'UNREALISTIC';
  warnings: string[];
  suggestedFix: string | null;
  consolidationPenaltyApplied: boolean;
}

export function evaluatePickValue(
  pickYear: number,
  pickRound: number,
  pickSlot: 'early' | 'mid' | 'late' = 'mid',
  pickNumber?: number
): number {
  const currentYear = new Date().getFullYear();
  const yearsOut = Math.max(0, pickYear - currentYear);
  
  let baseValue: number;
  
  if (pickNumber && pickNumber >= 1 && pickNumber <= 12) {
    const specificKey = `${pickRound}.${pickNumber.toString().padStart(2, '0')}`;
    if (PICK_SPECIFIC_SLOT_VALUES[specificKey]) {
      baseValue = PICK_SPECIFIC_SLOT_VALUES[specificKey];
    } else {
      baseValue = PICK_BASE_VALUES[pickRound] || 25;
      const slotModifier = PICK_SLOT_MODIFIERS[pickSlot] || 1.0;
      baseValue = Math.round(baseValue * slotModifier);
    }
  } else {
    baseValue = PICK_BASE_VALUES[pickRound] || 25;
    const slotModifier = PICK_SLOT_MODIFIERS[pickSlot] || 1.0;
    baseValue = Math.round(baseValue * slotModifier);
  }
  
  const timeDiscount = PICK_TIME_DISCOUNT[yearsOut] ?? 0.55;
  
  return Math.round(baseValue * timeDiscount);
}

export function evaluateAsset(
  asset: TradeAsset,
  settings: LeagueSettings = { isSF: true, isTEP: false, idpStarterCount: 0 }
): EvaluatedAsset {
  if (asset.isPick) {
    const pickYear = asset.pickYear || new Date().getFullYear() + 1;
    const pickRound = asset.pickRound || 1;
    const pickSlot = asset.pickSlot || 'mid';
    const pickNumber = asset.pickNumber;
    
    const pickValue = evaluatePickValue(pickYear, pickRound, pickSlot, pickNumber);
    
    return {
      ...asset,
      tier: null,
      baseValue: pickValue,
      ageCurveModifier: 0,
      formatModifier: 1.0,
      adjustedValue: pickValue,
      isIDP: false,
      isAging: false,
    };
  }

  const tieredPlayer = findPlayerTier(asset.name);
  const position = asset.position || tieredPlayer?.position || 'WR';
  const age = asset.age || tieredPlayer?.age;
  const tier = tieredPlayer?.tier ?? 4;
  
  const isIDP = isIDPPosition(position);
  const isAging = Boolean((position === 'RB' && age && age >= 26) || (position === 'WR' && age && age >= 28));
  
  const baseValue = TIER_BASE_VALUES[tier];
  const ageCurveModifier = getAgeCurveModifier(position, age);
  
  let formatModifier = 1.0;
  if (isIDP) {
    formatModifier = getIDPMultiplier(settings.idpStarterCount);
  } else {
    formatModifier = getFormatModifier(position, tier, settings.isSF, settings.isTEP);
  }
  
  const adjustedValue = Math.round(baseValue * (1 + ageCurveModifier) * formatModifier);

  return {
    ...asset,
    tier,
    baseValue,
    ageCurveModifier,
    formatModifier,
    adjustedValue,
    isIDP,
    isAging,
  };
}

function getBestTier(assets: EvaluatedAsset[]): AssetTier | null {
  const playerAssets = assets.filter(a => a.tier !== null);
  if (playerAssets.length === 0) return null;
  return Math.min(...playerAssets.map(a => a.tier!)) as AssetTier;
}

function checkTierParity(
  senderAssets: EvaluatedAsset[],
  receiverAssets: EvaluatedAsset[]
): { passed: boolean; senderBestTier: SemanticTier | null; receiverBestTier: SemanticTier | null; violation: string | null } {
  const senderBestNumeric = getBestTier(senderAssets);
  const receiverBestNumeric = getBestTier(receiverAssets);
  
  const senderBestTier = senderBestNumeric !== null ? TIER_TO_SEMANTIC[senderBestNumeric] : null;
  const receiverBestTier = receiverBestNumeric !== null ? TIER_TO_SEMANTIC[receiverBestNumeric] : null;
  
  if (receiverBestTier === 'elite') {
    const hasEliteReturn = senderBestTier === 'elite';
    const hasHighPlusPick = senderBestTier === 'high' && senderAssets.some(a => a.isPick && a.pickRound === 1);
    const hasTwoHigh = senderAssets.filter(a => a.tier !== null && a.tier <= 1).length >= 2;
    
    if (!hasEliteReturn && !hasHighPlusPick && !hasTwoHigh) {
      return {
        passed: false,
        senderBestTier,
        receiverBestTier,
        violation: `Elite assets require elite-level return: another elite OR (high-tier + 1st) OR (two high-tier assets)`
      };
    }
  }
  
  if (receiverBestTier === 'high' && senderBestTier !== 'elite' && senderBestTier !== 'high') {
    const hasStarterPlusPick = senderBestTier === 'starter' && senderAssets.some(a => a.isPick && a.pickRound === 1);
    if (!hasStarterPlusPick) {
      return {
        passed: false,
        senderBestTier,
        receiverBestTier,
        violation: `High-tier assets require tier parity: high-tier return OR (starter + 1st)`
      };
    }
  }
  
  return { passed: true, senderBestTier, receiverBestTier, violation: null };
}

function checkTimelineAlignment(
  senderAssets: EvaluatedAsset[],
  receiverAssets: EvaluatedAsset[],
  senderTimeline: 'contender' | 'rebuild' | 'middle',
  receiverTimeline: 'contender' | 'rebuild' | 'middle'
): { aligned: boolean; mismatchReason: string | null } {
  const senderAgingVets = senderAssets.filter(a => a.isAging);
  const receiverAgingVets = receiverAssets.filter(a => a.isAging);
  const senderPicks = senderAssets.filter(a => a.isPick);
  const receiverPicks = receiverAssets.filter(a => a.isPick);
  const senderYoungStars = senderAssets.filter(a => {
    if (!a.age || a.tier === null || a.tier > 2) return false;
    const pos = (a.position || '').toUpperCase();
    if (pos === 'RB') return a.age <= 24;
    return a.age <= 25;
  });
  
  if (senderTimeline === 'rebuild') {
    if (senderAgingVets.length >= 2 && receiverPicks.length === 0 && receiverAssets.filter(a => a.tier !== null && a.tier <= 2 && !a.isAging).length === 0) {
      return { aligned: false, mismatchReason: 'Rebuilding team acquiring aging vets without young assets or picks in return' };
    }
  }
  
  if (senderTimeline === 'contender') {
    if (senderYoungStars.length > 0 && receiverAgingVets.length >= 2 && receiverPicks.filter(a => a.pickRound === 1).length === 0) {
      return { aligned: false, mismatchReason: 'Contender trading young cornerstone for aging assets without elite return' };
    }
  }
  
  return { aligned: true, mismatchReason: null };
}

// NEW: Calculate window delta between two asset sides
function calculateWindowDelta(senderAssets: EvaluatedAsset[], receiverAssets: EvaluatedAsset[]): number {
  const getAvgWindow = (assets: EvaluatedAsset[]) => {
    const playerAssets = assets.filter(a => !a.isPick && a.position && a.age);
    if (playerAssets.length === 0) return 5;
    const totalWindow = playerAssets.reduce((sum, a) => {
      return sum + getExpectedWindow(a.position || 'WR', a.age);
    }, 0);
    return totalWindow / playerAssets.length;
  };
  
  return Math.abs(getAvgWindow(senderAssets) - getAvgWindow(receiverAssets));
}

function performSanityCheck(
  senderAssets: EvaluatedAsset[],
  receiverAssets: EvaluatedAsset[],
  deltaPct: number,
  tierParity: { passed: boolean; violation: string | null },
  settings: LeagueSettings
): { wouldMostReject: boolean; rejectReason: string | null; rejectionRate: number; windowMismatch: boolean; windowMismatchYears: number; qbRbVeto: boolean; asymmetricValue: boolean } {
  let rejectionRate = 0;
  const reasons: string[] = [];
  let windowMismatch = false;
  let windowMismatchYears = 0;
  let qbRbVeto = false;
  let asymmetricValue = false;
  
  if (deltaPct >= 30) {
    rejectionRate = Math.min(95, 70 + deltaPct - 30);
    reasons.push(`Value gap of ${deltaPct}% is too large`);
  }
  
  if (!tierParity.passed) {
    rejectionRate = Math.max(rejectionRate, 80);
    reasons.push(tierParity.violation || 'Tier parity not met');
  }
  
  const receiverElite = receiverAssets.filter(a => a.tier !== null && a.tier <= 1);
  const senderLowTier = senderAssets.filter(a => a.tier !== null && a.tier >= 3);
  if (receiverElite.length > 0 && senderAssets.length >= 3 && senderLowTier.length >= 2) {
    rejectionRate = Math.max(rejectionRate, 85);
    reasons.push('Garbage bundle for elite asset - quantity does not equal quality');
  }
  
  // RULE 1: QB-for-RB in Superflex (Hard Gate)
  if (settings.isSF) {
    const receiverQBs = receiverAssets.filter(a => (a.position || '').toUpperCase() === 'QB' && a.tier !== null && a.tier <= 2);
    const senderAgingRBs = senderAssets.filter(a => (a.position || '').toUpperCase() === 'RB' && a.age && a.age >= 27);
    const senderHasQB = senderAssets.some(a => (a.position || '').toUpperCase() === 'QB');
    const senderHasEarly1st = senderAssets.some(a => a.isPick && a.pickRound === 1 && a.pickSlot === 'early');
    const senderHasWR1 = senderAssets.some(a => (a.position || '').toUpperCase() === 'WR' && a.tier !== null && a.tier <= 1);
    
    // If trading QB for aging RB without premium asset added
    if (receiverQBs.length > 0 && senderAgingRBs.length > 0 && !senderHasQB && !senderHasEarly1st && !senderHasWR1) {
      rejectionRate = Math.max(rejectionRate, 85);
      qbRbVeto = true;
      reasons.push('SF Veto: QB vs aging RB requires premium asset (WR1, early 1st, or QB) added');
    }
    
    // Original QB check
    const receiverTopQB = receiverAssets.filter(a => (a.position || '').toUpperCase() === 'QB' && a.tier !== null && a.tier <= 1);
    if (receiverTopQB.length > 0 && !senderHasQB && !senderHasEarly1st) {
      rejectionRate = Math.max(rejectionRate, 75);
      reasons.push('SF league: Elite QB requires QB or early 1st in return');
    }
  }
  
  // RULE 2: Window Mismatch Flag (5+ years difference = grade downgrade)
  windowMismatchYears = calculateWindowDelta(senderAssets, receiverAssets);
  if (windowMismatchYears >= 5) {
    windowMismatch = true;
    rejectionRate = Math.max(rejectionRate, 60);
    reasons.push(`Window mismatch: ${windowMismatchYears.toFixed(1)} year difference in expected production`);
  }
  
  // RULE 3: Single-Asset Fragility (1 aging RB for cornerstone)
  const senderSingleAgingRB = senderAssets.filter(a => !a.isPick).length === 1 && 
    senderAssets.some(a => (a.position || '').toUpperCase() === 'RB' && a.age && a.age >= 28);
  const receiverCornerstone = receiverAssets.some(a => 
    ((a.position || '').toUpperCase() === 'QB' || (a.position || '').toUpperCase() === 'WR') && 
    a.tier !== null && a.tier <= 1
  );
  if (senderSingleAgingRB && receiverCornerstone) {
    asymmetricValue = true;
    rejectionRate = Math.max(rejectionRate, 80);
    reasons.push('Asymmetric Value: Single aging RB cannot acquire QB/WR cornerstone');
  }
  
  const receiverYoungCornerstone = receiverAssets.filter(a => {
    if (!a.age || a.tier === null || a.tier > 1) return false;
    return a.age <= 25;
  });
  const senderAgingCount = senderAssets.filter(a => a.isAging).length;
  if (receiverYoungCornerstone.length > 0 && senderAgingCount >= 2 && !senderAssets.some(a => a.isPick && a.pickRound === 1 && a.pickSlot === 'early')) {
    rejectionRate = Math.max(rejectionRate, 80);
    reasons.push('Young cornerstone traded for multiple aging assets');
  }
  
  return {
    wouldMostReject: rejectionRate >= 70,
    rejectReason: reasons.length > 0 ? reasons[0] : null,
    rejectionRate,
    windowMismatch,
    windowMismatchYears,
    qbRbVeto,
    asymmetricValue
  };
}

export function evaluateTrade(
  senderGives: TradeAsset[],
  receiverGives: TradeAsset[],
  settings: LeagueSettings = { isSF: true, isTEP: false, idpStarterCount: 0 },
  senderTimeline: 'contender' | 'rebuild' | 'middle' = 'middle',
  receiverTimeline: 'contender' | 'rebuild' | 'middle' = 'middle'
): TradeEvaluation {
  const senderAssets = senderGives.map(a => evaluateAsset(a, settings));
  const receiverAssets = receiverGives.map(a => evaluateAsset(a, settings));
  
  let senderTotalValue = senderAssets.reduce((sum, a) => sum + a.adjustedValue, 0);
  let receiverTotalValue = receiverAssets.reduce((sum, a) => sum + a.adjustedValue, 0);
  
  if (senderTimeline === 'contender') {
    senderAssets.filter(a => a.isAging).forEach(a => { senderTotalValue += Math.round(a.adjustedValue * 0.05); });
    senderAssets.filter(a => a.isPick).forEach(a => { senderTotalValue -= Math.round(a.adjustedValue * 0.05); });
  } else if (senderTimeline === 'rebuild') {
    senderAssets.filter(a => a.isPick || (a.tier !== null && a.tier <= 2 && !a.isAging)).forEach(a => { senderTotalValue += Math.round(a.adjustedValue * 0.08); });
    senderAssets.filter(a => a.isAging).forEach(a => { senderTotalValue -= Math.round(a.adjustedValue * 0.08); });
  }
  
  let consolidationPenaltyApplied = false;
  const allAssets = [...senderAssets, ...receiverAssets];
  const bestAsset = allAssets.reduce((best, curr) => 
    (curr.adjustedValue > best.adjustedValue) ? curr : best
  );
  
  const receiverHasBest = receiverAssets.some(a => a.name === bestAsset.name);
  if (receiverHasBest && senderAssets.length >= 3) {
    senderTotalValue = Math.round(senderTotalValue * 0.88);
    consolidationPenaltyApplied = true;
  }
  
  const senderHasBest = senderAssets.some(a => a.name === bestAsset.name);
  if (senderHasBest && receiverAssets.length >= 3) {
    receiverTotalValue = Math.round(receiverTotalValue * 0.88);
    consolidationPenaltyApplied = true;
  }
  
  const maxValue = Math.max(senderTotalValue, receiverTotalValue);
  const deltaPct = maxValue > 0 ? Math.round(Math.abs(senderTotalValue - receiverTotalValue) / maxValue * 100) : 100;
  const minValue = Math.min(senderTotalValue, receiverTotalValue);
  const valueRatio = minValue > 0 ? maxValue / minValue : 999;
  
  const tierParityCheck = checkTierParity(senderAssets, receiverAssets);
  const timelineCheck = {
    senderTimeline,
    receiverTimeline,
    ...checkTimelineAlignment(senderAssets, receiverAssets, senderTimeline, receiverTimeline)
  };
  const sanityCheck = performSanityCheck(senderAssets, receiverAssets, deltaPct, tierParityCheck, settings);
  
  const warnings: string[] = [];
  let tierViolation = !tierParityCheck.passed;
  let tierViolationReason = tierParityCheck.violation;
  
  if (tierViolation && tierViolationReason) {
    warnings.push(`TIER VIOLATION: ${tierViolationReason}`);
  }
  
  if (!timelineCheck.aligned && timelineCheck.mismatchReason) {
    warnings.push(`TIMELINE MISMATCH: ${timelineCheck.mismatchReason}`);
  }
  
  if (sanityCheck.wouldMostReject && sanityCheck.rejectReason) {
    warnings.push(`SANITY CHECK FAILED (${sanityCheck.rejectionRate}% would reject): ${sanityCheck.rejectReason}`);
  }
  
  const idpAssets = senderAssets.filter(a => a.isIDP);
  if (idpAssets.length > 0 && receiverAssets.some(a => a.tier !== null && a.tier <= 2)) {
    if (settings.idpStarterCount === 0) {
      warnings.push(`IDP players (${idpAssets.map(a => a.name).join(', ')}) have minimal value in offense-only leagues`);
    }
  }
  
  const agingAssets = senderAssets.filter(a => a.isAging);
  if (agingAssets.length > 0) {
    warnings.push(`Aging assets with depreciated value: ${agingAssets.map(a => a.name).join(', ')}`);
  }
  
  if (consolidationPenaltyApplied) {
    warnings.push('Consolidation penalty applied (12%) - depth does not equal stars');
  }
  
  let plausibility: TradeEvaluation['plausibility'];
  let verdict: TradeEvaluation['verdict'];
  let maxGrade: string;
  
  if (sanityCheck.wouldMostReject || tierViolation || deltaPct >= 30) {
    plausibility = 'UNREALISTIC';
    verdict = 'UNREALISTIC';
    maxGrade = 'C-';
  } else if (deltaPct >= 20 || !timelineCheck.aligned) {
    plausibility = 'LOW';
    verdict = 'VERY_LOPSIDED';
    maxGrade = 'D';
  } else if (deltaPct >= 12) {
    plausibility = 'MEDIUM';
    verdict = 'LOPSIDED';
    maxGrade = 'C';
  } else if (deltaPct >= 5) {
    plausibility = 'HIGH';
    verdict = 'SLIGHT_EDGE';
    maxGrade = 'B';
  } else {
    plausibility = 'HIGH';
    verdict = 'FAIR';
    maxGrade = 'A-';
  }
  
  if (agingAssets.length >= 2 && maxGrade === 'A-') {
    maxGrade = 'B+';
    warnings.push('Grade capped due to multiple aging assets');
  }
  
  let suggestedFix: string | null = null;
  if (plausibility === 'UNREALISTIC') {
    if (tierViolation) {
      suggestedFix = 'Add an early 1st OR include an elite/high-tier asset to make this realistic';
    } else if (sanityCheck.wouldMostReject) {
      suggestedFix = `${sanityCheck.rejectionRate}% of managers would reject. Add significant value to close the gap.`;
    } else {
      suggestedFix = 'Value gap too large - add premium picks or reduce ask';
    }
  } else if (plausibility === 'LOW') {
    suggestedFix = 'Add a mid-1st or high-tier player to balance this trade';
  }
  
  // Calculate window analysis
  const getAvgWindowForSide = (assets: EvaluatedAsset[]) => {
    const playerAssets = assets.filter(a => !a.isPick && a.position && a.age);
    if (playerAssets.length === 0) return 5;
    return playerAssets.reduce((sum, a) => sum + getExpectedWindow(a.position || 'WR', a.age), 0) / playerAssets.length;
  };
  
  const senderAvgWindow = getAvgWindowForSide(senderAssets);
  const receiverAvgWindow = getAvgWindowForSide(receiverAssets);
  const windowDelta = Math.abs(senderAvgWindow - receiverAvgWindow);
  
  // Determine dynasty verdict
  let dynastyVerdict: 'LONG_TERM_WIN' | 'SHORT_TERM_WIN' | 'BALANCED' | 'ASYMMETRIC';
  let dynastyLabel: string;
  
  if (sanityCheck.asymmetricValue) {
    dynastyVerdict = 'ASYMMETRIC';
    dynastyLabel = 'Asymmetric Value - Dynasty format strongly disfavors this trade structure';
  } else if (windowDelta >= 5) {
    if (receiverAvgWindow > senderAvgWindow) {
      dynastyVerdict = 'LONG_TERM_WIN';
      dynastyLabel = 'Long-Term Dynasty Win / Short-Term Production Loss';
    } else {
      dynastyVerdict = 'SHORT_TERM_WIN';
      dynastyLabel = 'Short-Term Production Win / Long-Term Dynasty Loss';
    }
  } else if (windowDelta >= 2) {
    if (receiverAvgWindow > senderAvgWindow) {
      dynastyVerdict = 'LONG_TERM_WIN';
      dynastyLabel = 'Slight Long-Term Advantage';
    } else {
      dynastyVerdict = 'SHORT_TERM_WIN';
      dynastyLabel = 'Slight Short-Term Advantage';
    }
  } else {
    dynastyVerdict = 'BALANCED';
    dynastyLabel = 'Balanced Trade - Similar Production Windows';
  }
  
  // Add window mismatch warning
  if (sanityCheck.windowMismatch) {
    warnings.push(`WINDOW MISMATCH: ${sanityCheck.windowMismatchYears.toFixed(1)} year production gap - ${dynastyLabel}`);
  }
  
  // Add QB-RB veto warning
  if (sanityCheck.qbRbVeto) {
    warnings.push('SF VETO: QB-for-aging-RB trades require premium asset (WR1, early 1st, or QB) added');
  }
  
  // Add asymmetric value warning
  if (sanityCheck.asymmetricValue) {
    warnings.push('ASYMMETRIC VALUE: Single aging RB cannot acquire QB/WR cornerstone in dynasty');
  }

  return {
    senderAssets,
    receiverAssets,
    senderTotalValue,
    receiverTotalValue,
    deltaPct,
    valueRatio,
    tierViolation,
    tierViolationReason,
    tierParityCheck,
    timelineCheck,
    sanityCheck,
    windowAnalysis: {
      senderAvgWindow,
      receiverAvgWindow,
      windowDelta,
      dynastyVerdict,
      dynastyLabel,
    },
    plausibility,
    maxGrade,
    verdict,
    warnings,
    suggestedFix,
    consolidationPenaltyApplied,
  };
}

export function formatEvaluationForAI(evaluation: TradeEvaluation): string {
  const tierParityStatus = evaluation.tierParityCheck.passed 
    ? 'PASSED' 
    : `FAILED - ${evaluation.tierParityCheck.violation}`;
  
  const timelineStatus = evaluation.timelineCheck.aligned 
    ? 'ALIGNED' 
    : `MISALIGNED - ${evaluation.timelineCheck.mismatchReason}`;
  
  const sanityStatus = evaluation.sanityCheck.wouldMostReject 
    ? `FAILED (${evaluation.sanityCheck.rejectionRate}% would reject) - ${evaluation.sanityCheck.rejectReason}` 
    : `PASSED (${evaluation.sanityCheck.rejectionRate}% rejection estimate)`;
  
  const windowStatus = evaluation.sanityCheck.windowMismatch
    ? `FLAGGED - ${evaluation.windowAnalysis.windowDelta.toFixed(1)} year gap`
    : `OK - ${evaluation.windowAnalysis.windowDelta.toFixed(1)} year gap`;

  return `
DETERMINISTIC TRADE EVALUATION RESULTS (AI MUST FOLLOW):
=========================================================
Trade Verdict: ${evaluation.verdict}
Dynasty Verdict: ${evaluation.windowAnalysis.dynastyLabel}
Maximum Allowed Grade: ${evaluation.maxGrade}
Market Plausibility: ${evaluation.plausibility}

VETO LAYER CHECKS:
------------------
1. Tier Parity: ${tierParityStatus}
   - Sender best tier: ${evaluation.tierParityCheck.senderBestTier || 'N/A (picks only)'}
   - Receiver best tier: ${evaluation.tierParityCheck.receiverBestTier || 'N/A (picks only)'}

2. Timeline Alignment: ${timelineStatus}
   - Sender timeline: ${evaluation.timelineCheck.senderTimeline}
   - Receiver timeline: ${evaluation.timelineCheck.receiverTimeline}

3. Sanity Check (Would 70%+ reject?): ${sanityStatus}
   - QB-RB Veto (SF): ${evaluation.sanityCheck.qbRbVeto ? 'TRIGGERED - Premium asset required' : 'OK'}
   - Asymmetric Value: ${evaluation.sanityCheck.asymmetricValue ? 'TRIGGERED - Single aging RB for cornerstone' : 'OK'}

4. Window Mismatch: ${windowStatus}
   - Sender avg window: ${evaluation.windowAnalysis.senderAvgWindow.toFixed(1)} years
   - Receiver avg window: ${evaluation.windowAnalysis.receiverAvgWindow.toFixed(1)} years

VALUE ANALYSIS:
---------------
- Sender gives total adjusted value: ${evaluation.senderTotalValue} DVP
- Receiver gives total adjusted value: ${evaluation.receiverTotalValue} DVP
- Delta percentage: ${evaluation.deltaPct}%
- Value ratio: ${evaluation.valueRatio.toFixed(2)}
- Consolidation penalty applied: ${evaluation.consolidationPenaltyApplied ? 'YES (-12%)' : 'NO'}

ASSET BREAKDOWN:
----------------
Sender Assets (what sender gives up):
${evaluation.senderAssets.map(a => {
  const tierLabel = a.tier !== null ? `Tier ${a.tier} (${TIER_TO_SEMANTIC[a.tier as AssetTier]})` : 'PICK';
  const window = a.position && a.age ? `~${getExpectedWindow(a.position, a.age).toFixed(1)}yr window` : '';
  return `  - ${a.name}: ${tierLabel}, ${a.adjustedValue} DVP${window ? ` [${window}]` : ''}${a.isIDP ? ' [IDP]' : ''}${a.isAging ? ' [AGING]' : ''}`;
}).join('\n')}

Receiver Assets (what receiver gives up):
${evaluation.receiverAssets.map(a => {
  const tierLabel = a.tier !== null ? `Tier ${a.tier} (${TIER_TO_SEMANTIC[a.tier as AssetTier]})` : 'PICK';
  const window = a.position && a.age ? `~${getExpectedWindow(a.position, a.age).toFixed(1)}yr window` : '';
  return `  - ${a.name}: ${tierLabel}, ${a.adjustedValue} DVP${window ? ` [${window}]` : ''}${a.isIDP ? ' [IDP]' : ''}${a.isAging ? ' [AGING]' : ''}`;
}).join('\n')}

${evaluation.warnings.length > 0 ? `REQUIRED WARNINGS (MUST MENTION ALL):\n${evaluation.warnings.map(w => `  ⚠️ ${w}`).join('\n')}` : ''}

${evaluation.suggestedFix ? `WHAT IT WOULD TAKE: ${evaluation.suggestedFix}` : ''}

AI INSTRUCTIONS (MANDATORY):
============================
1. You may NOT assign a grade higher than ${evaluation.maxGrade}
2. You MUST explain why the trade is ${evaluation.verdict.toLowerCase().replace(/_/g, ' ')}
3. You MUST use the dynasty verdict label: "${evaluation.windowAnalysis.dynastyLabel}"
4. You MUST reference all failed veto checks (tier parity, timeline, sanity, window)
5. You MUST mention all required warnings above
6. You may NOT justify an unrealistic trade using "team needs" or "win-now mode" alone
7. If verdict is UNREALISTIC, firmly state: "This trade would be rejected by most dynasty managers"
8. If sanity check failed, explain why ${evaluation.sanityCheck.rejectionRate}% would reject
9. If window mismatch >= 5 years, clearly label as "Long-Term Win" or "Short-Term Win"
10. Always suggest what would make this trade viable
11. Elite-tier assets (Tier 0-1) require elite-tier returns - no exceptions
12. Garbage bundles (3+ low-tier assets for 1 elite) are never acceptable
13. QB-for-aging-RB in SF leagues requires premium asset added (WR1, early 1st, or QB)
`.trim();
}

export function detectIDPFromRosterPositions(rosterPositions: string[]): number {
  const idpPositions = ['LB', 'DB', 'DL', 'DE', 'DT', 'S', 'CB', 'IDP', 'ED', 'EDGE'];
  let count = 0;
  
  for (const pos of rosterPositions) {
    const upper = pos.toUpperCase();
    if (idpPositions.includes(upper)) {
      count++;
    }
  }
  
  return count;
}

export function detectSFFromRosterPositions(rosterPositions: string[]): boolean {
  const sfPositions = ['SUPER_FLEX', 'SUPERFLEX', 'SF'];
  return rosterPositions.some(pos => sfPositions.includes(pos.toUpperCase()));
}

export type GradeType = 'A+' | 'A' | 'A-' | 'B+' | 'B' | 'B-' | 'C+' | 'C' | 'C-' | 'D' | 'F';

export const GRADE_PRIORITY: GradeType[] = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D', 'F'];

export function shouldShowAsSuggestion(evaluation: TradeEvaluation): boolean {
  if (evaluation.tierViolation) return false;
  if (evaluation.valueRatio >= 1.60) return false;
  if (evaluation.plausibility === 'UNREALISTIC') return false;
  if (evaluation.verdict === 'UNREALISTIC' || evaluation.verdict === 'VERY_LOPSIDED') return false;
  
  const idpOnlyTrade = evaluation.senderAssets.every(a => a.isIDP || a.isPick);
  const targetingElite = evaluation.receiverAssets.some(a => a.tier !== null && a.tier <= 1);
  if (idpOnlyTrade && targetingElite) return false;
  
  return true;
}

export function enforceGradeDistribution(
  grades: GradeType[],
  maxDistribution: Record<string, number> = {
    'A+': 0.01,
    'A': 0.10,
    'A-': 0.15,
    'B+': 0.20,
    'B': 0.25,
    'B-': 0.15,
    'C+': 0.10,
    'C': 0.15,
    'C-': 0.10,
    'D': 0.10,
    'F': 0.10,
  }
): GradeType[] {
  const total = grades.length;
  if (total === 0) return grades;
  
  const currentCounts: Record<string, number> = {};
  const adjustedGrades: GradeType[] = [...grades];
  
  for (const grade of GRADE_PRIORITY) {
    currentCounts[grade] = grades.filter(g => g === grade).length;
  }
  
  for (let i = 0; i < adjustedGrades.length; i++) {
    const grade = adjustedGrades[i];
    const maxCount = Math.max(1, Math.floor(total * (maxDistribution[grade] || 0.10)));
    
    if (currentCounts[grade] > maxCount) {
      const gradeIndex = GRADE_PRIORITY.indexOf(grade);
      if (gradeIndex < GRADE_PRIORITY.length - 1) {
        const newGrade = GRADE_PRIORITY[gradeIndex + 1];
        adjustedGrades[i] = newGrade;
        currentCounts[grade]--;
        currentCounts[newGrade] = (currentCounts[newGrade] || 0) + 1;
      }
    }
  }
  
  return adjustedGrades;
}

export function isIDPKillSwitchTriggered(
  evaluation: TradeEvaluation,
  idpStarterCount: number
): boolean {
  if (idpStarterCount > 3) return false;
  
  const idpAssets = evaluation.senderAssets.filter(a => a.isIDP);
  const offensiveStars = evaluation.receiverAssets.filter(a => a.tier !== null && a.tier <= 2);
  
  if (idpAssets.length === 0 || offensiveStars.length === 0) return false;
  
  const idpValue = idpAssets.reduce((sum, a) => sum + a.adjustedValue, 0);
  const offensiveValue = offensiveStars.reduce((sum, a) => sum + a.adjustedValue, 0);
  
  return idpValue > (offensiveValue * 0.30);
}

export function categorizeTradeSuggestion(evaluation: TradeEvaluation): 'VIABLE' | 'AGGRESSIVE' | 'UNREALISTIC' {
  if (!shouldShowAsSuggestion(evaluation)) {
    return 'UNREALISTIC';
  }
  
  if (evaluation.plausibility === 'MEDIUM' || evaluation.verdict === 'LOPSIDED') {
    return 'AGGRESSIVE';
  }
  
  return 'VIABLE';
}

export function filterAndCategorizeSuggestions(evaluations: TradeEvaluation[]): {
  viable: TradeEvaluation[];
  aggressive: TradeEvaluation[];
  unrealistic: TradeEvaluation[];
} {
  const viable: TradeEvaluation[] = [];
  const aggressive: TradeEvaluation[] = [];
  const unrealistic: TradeEvaluation[] = [];
  
  for (const evaluation of evaluations) {
    const category = categorizeTradeSuggestion(evaluation);
    
    switch (category) {
      case 'VIABLE':
        viable.push(evaluation);
        break;
      case 'AGGRESSIVE':
        aggressive.push(evaluation);
        break;
      case 'UNREALISTIC':
        unrealistic.push(evaluation);
        break;
    }
  }
  
  return { viable, aggressive, unrealistic };
}
