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

// ============================================================================
// LAYER 2: POSITIONAL REPLACEMENT VALUE (Redraft's Secret Sauce)
// ============================================================================

// ============================================================================
// LAYER 3: MARKET PLAUSIBILITY (Redraft Edition)
// ============================================================================

// ============================================================================
// LAYER 4: TIMELINE CONSISTENCY (Playoff Schedule)
// ============================================================================

// ============================================================================
// COMPLETE VALUE FORMULA
// ============================================================================

// ============================================================================
// TRADE EVALUATION
// ============================================================================

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
