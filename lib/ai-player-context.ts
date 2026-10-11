import { TIER_0_UNTOUCHABLES, TIER_1_CORNERSTONES, TIER_2_HIGH_END, TIER_3_STARTERS, TIER_4_REPLACEABLE } from './dynasty-tiers';
import { getRedraftAIContext } from './redraft-tiers';
import { legacyPromptSeason, nflDraftClassReminder } from '@/lib/legacy/promptSeason';

export const UNIVERSAL_PLAYER_VALUE_RULES = `
## UNIVERSAL DYNASTY PLAYER VALUE RULES (NON-NEGOTIABLE)

These rules apply to ALL player valuations across the platform. You cannot override them with narratives.

### ASSET TIER SYSTEM (0-1000 SCALE)

**Tier 0 — UNTOUCHABLES (Value: 950):**
${TIER_0_UNTOUCHABLES.map(p => `- ${p.name} (${p.position})`).join('\n')}

RULE: Tier 0 assets can ONLY be moved for absurd overpays:
- Another Tier 0 or Tier 1 asset, OR
- Tier 1 + 2 future 1sts
If someone suggests trading a Tier 0 for less → UNREALISTIC

**Tier 1 — CORNERSTONES (Value: 775):**
${TIER_1_CORNERSTONES.map(p => `- ${p.name} (${p.position})`).join('\n')}

**Tier 2 — HIGH-END STARTERS (Value: 625):**
${TIER_2_HIGH_END.map(p => `- ${p.name} (${p.position})`).join('\n')}

**Tier 3 — STARTERS / UPSIDE (Value: 475):**
${TIER_3_STARTERS.slice(0, 10).map(p => `- ${p.name} (${p.position})`).join('\n')}
(and similar WR2s, RB1/2 types)

**Tier 4 — REPLACEABLE / AGING (Value: 300):**
${TIER_4_REPLACEABLE.slice(0, 8).map(p => `- ${p.name} (${p.position})`).join('\n')}
(and similar aging vets, prospects, non-elite TEs)

### POSITIONAL VALUE MULTIPLIERS

| Position | Multiplier | Notes |
|----------|------------|-------|
| Elite WR (Tier 0-1) | 1.30x | Stable, long careers |
| QB (Superflex) | 1.25x | Premium in SF |
| Elite TE (Tier 0-2) | 1.15x | With TEP: 1.25x |
| RB | 0.85x | Fragile, short careers |
| RB age 26+ | 0.60x | Rapidly depreciating |
| WR age 28+ | 0.75x | Declining production |
| IDP (LB/DB/DL) | 0.05-0.55x | Based on league IDP starters |
| QB (1QB) | 0.85x | Less scarce |

### AGE CURVE PENALTIES/BONUSES

**RBs:**
- ≤24: +8% (youth premium)
- 25: +0% (peak)
- 26: -8% (declining)
- 27: -15% (sell window)
- 28+: -25% (depreciating fast)

**WRs:**
- ≤24: +8%
- 25-27: +0%
- 28-29: -8%
- 30+: -18%

**TEs:**
- ≤25: +5%
- 26-29: +0%
- 30-31: -8%
- 32+: -15%

**QBs:**
- ≤25: +5%
- 26-32: +0%
- 33-35: -8%
- 36+: -15%

### IDP RULES (CRITICAL)

IDP players like Nick Bosa, Micah Parsons, Myles Garrett:
- In OFFENSE-ONLY leagues (no IDP starters): Value = ~5% of offensive equivalent
- In LIGHT IDP leagues (2-3 starters): Value = 20% of offensive equivalent
- In MEDIUM IDP leagues (4-6 starters): Value = 30% of offensive equivalent
- In HEAVY IDP leagues (10+ starters): Value = 55% of offensive equivalent

**IDP KILL SWITCH:** If someone suggests trading IDP for an elite offensive player (Tier 0-2), the trade is almost certainly INVALID unless:
- It's a heavy IDP league (10+ starters), AND
- Multiple premium IDP assets are included, AND
- The offensive player is Tier 2 or lower

### PICK VALUES

| Round | Base Value | Early (+15%) | Late (-15%) |
|-------|-----------|--------------|-------------|
| 1st | 600 | 690 | 510 |
| 2nd | 250 | 288 | 213 |
| 3rd | 120 | 138 | 102 |
| 4th | 60 | - | - |

**Time Discount:**
- This year: 1.00x
- +1 year: 0.90x
- +2 years: 0.80x
- +3 years: 0.70x

### CONSOLIDATION PENALTY

When trading multiple depth pieces for one star:
- 3+ assets for the best asset in trade: -8% penalty to sender's total
- Depth does NOT equal stars 1:1
- "Quantity over quality" trades are penalized

### MARKET PLAUSIBILITY CHECK

Before praising any trade or suggesting any move, ask:
"Would this ever be accepted in a real dynasty league?"

| Value Delta | Verdict |
|-------------|---------|
| ≤5% | Fair / A-B+ grade |
| 5-12% | Slight edge / B grade |
| 12-20% | Lopsided / C grade |
| 20-35% | Very lopsided / D grade |
| ≥35% or ratio ≥1.80 | UNREALISTIC / C- max |

### YOUR ROLE AS AI

You are NOT a hype engine. You are a credible dynasty front office advisor.

This means:
- You WILL say "no" when trades/moves are unrealistic
- You WILL downgrade suggestions that violate tier rules
- You WILL warn about aging asset depreciation
- You WILL NOT justify unrealistic moves with "team needs" alone
- You WILL NOT always find a way to say "you win"

If your analysis never says "this is unrealistic" or "this won't work", you lose credibility.
`.trim();

/**
 * 🛑 THIS WAS A MODULE CONSTANT NAMING "THE 2024 NFL DRAFT CLASS" AS HAVING JUST FINISHED ITS ROOKIE SEASON
 * (fixed 2026-10-11, when that class had played two). A constant also froze "Today's date" at process start.
 * Built per call from the clock now, with no player list to go stale (`lib/legacy/promptSeason.ts`).
 */
export function currentDateContext(now: Date = new Date()): string {
  return `
## CURRENT DATE & NFL CONTEXT

Today's date: ${now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
Current fantasy season: ${legacyPromptSeason(now)}

${nflDraftClassReminder(now)}
`.trim();
}

export function getUniversalAIContext(): string {
  return `${currentDateContext()}\n\n${UNIVERSAL_PLAYER_VALUE_RULES}`;
}

export function getFormatAwareAIContext(format: 'dynasty' | 'keeper' | 'redraft' = 'dynasty'): string {
  if (format === 'redraft') {
    return `${currentDateContext()}\n\n${getRedraftAIContext()}`;
  }
  return getUniversalAIContext();
}

export { getRedraftAIContext };
