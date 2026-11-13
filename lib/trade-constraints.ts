import { findPlayerTier } from './dynasty-tiers';

// ============================================
// AI PROMPT TEMPLATES (Controlled AI Layer)
// ============================================
// AI can ONLY see candidate trades, values, needs, reasons, verdicts
// AI is FORBIDDEN from changing totals or proposing new values

// ============================================
// UI LABELS & DISPLAY SYSTEM
// ============================================

// ============================================
// DYNAMIC THRESHOLD CALCULATION (from FantasyCalc)
// ============================================

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

// ============================================
// CONFIGURABLE CORNERSTONE THRESHOLDS
// ============================================

// ============================================
// LEAGUE-LEVEL CONSTRAINTS
// ============================================

// ============================================
// HARD REJECT VALIDATION
// ============================================

// ============================================
// UNIFIED ASSET TYPE
// ============================================

// ============================================
// COMPOSITE FAIRNESS SCORING SYSTEM
// ============================================

// ============================================
// FACTS-BASED EXPLANATION SYSTEM
// ============================================
// Only use provable facts from roster/standings data

// ============================================
// NON-NEGOTIABLE TRADE REJECTION RULES
// ============================================

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
