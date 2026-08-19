/**
 * Cross-provider `roster_positions` normalization — Fantasy OS Migration Plan
 * Milestone 4 (Trade context assembler provider-neutrality fix).
 *
 * Real gap found during the audit: Sleeper's `roster_positions` is a flat
 * list with one token per roster slot (e.g. `["QB","RB","RB","FLEX","BN","BN"]`).
 * ESPN and Yahoo's adapters instead emit "SLOT:COUNT" pairs (confirmed by
 * reading lib/league-import/adapters/{espn,yahoo}/*Adapter.ts directly —
 * e.g. ESPN's `rosterPositions.map(slot => \`${slot.slot}:${slot.count}\`)`).
 * Naively reusing the trade assembler's original Sleeper-only parsing
 * (`some(p => p === 'SUPER_FLEX')`, `filter(p => p === 'BN')`) against an
 * ESPN/Yahoo payload would silently fail to detect superflex/bench/starter
 * slots, since a whole string like `"SUPER_FLEX:1"` never equals `"SUPER_FLEX"`.
 *
 * `expandRosterPositionTokens` normalizes both shapes into Sleeper's flat,
 * one-token-per-slot form, so every downstream classification helper below
 * (and the assembler itself) can treat every provider identically from that
 * point on.
 */

/** Confirmed via ESPN_SLOT_LABELS (lib/league-import/espn/EspnLeagueFetchService.ts) and Sleeper's own raw token — both providers use this exact literal. */
const SUPERFLEX_TOKENS = new Set(['SUPER_FLEX', 'SF'])
/** ESPN uses 'BE' (ESPN_SLOT_LABELS[20]); Sleeper and Yahoo use 'BN' (confirmed via Yahoo's own YAHOO_RESERVE_POSITIONS set). */
const BENCH_TOKENS = new Set(['BN', 'BE'])
const IR_TOKENS = new Set(['IR', 'IL'])
const TAXI_TOKENS = new Set(['TAXI', 'TX'])

/**
 * Expands "SLOT:COUNT" pairs (ESPN/Yahoo) into `count` repeated flat tokens,
 * matching Sleeper's native one-token-per-slot shape. A token with no colon
 * (Sleeper's own format, or any other provider that already emits flat
 * tokens) passes through unchanged — this function is a no-op for Sleeper.
 */
export function expandRosterPositionTokens(rawPositions: string[]): string[] {
  const expanded: string[] = []
  for (const raw of rawPositions) {
    const token = String(raw ?? '').trim()
    if (!token) continue

    const colonIndex = token.lastIndexOf(':')
    if (colonIndex === -1) {
      expanded.push(token.toUpperCase())
      continue
    }

    const slotName = token.slice(0, colonIndex).toUpperCase()
    const countStr = token.slice(colonIndex + 1)
    const count = Number.parseInt(countStr, 10)
    if (!Number.isFinite(count) || count <= 0) {
      // Not actually a SLOT:COUNT pair (e.g. a slot name that happens to contain
      // a colon) — fall back to treating the whole token as one flat slot.
      expanded.push(token.toUpperCase())
      continue
    }
    for (let i = 0; i < count; i++) expanded.push(slotName)
  }
  return expanded
}

export function isSuperflexToken(token: string): boolean {
  return SUPERFLEX_TOKENS.has(token.toUpperCase())
}

export function isBenchToken(token: string): boolean {
  return BENCH_TOKENS.has(token.toUpperCase())
}

export function isIrToken(token: string): boolean {
  return IR_TOKENS.has(token.toUpperCase())
}

export function isTaxiToken(token: string): boolean {
  return TAXI_TOKENS.has(token.toUpperCase())
}

/**
 * Starter slot count = every expanded token that isn't bench or IR — mirrors
 * the assembler's original Sleeper-only logic exactly (`p !== 'BN' && p !== 'IR'`),
 * generalized across the bench/IR synonyms above.
 */
export function countStarterSlots(expandedPositions: string[]): number {
  return expandedPositions.filter((p) => !isBenchToken(p) && !isIrToken(p)).length
}

export function countBenchSlots(expandedPositions: string[]): number {
  return expandedPositions.filter(isBenchToken).length
}

export function countTaxiSlotsFromPositions(expandedPositions: string[]): number {
  return expandedPositions.filter(isTaxiToken).length
}
