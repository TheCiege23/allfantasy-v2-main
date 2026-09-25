import type { LeagueRosterConfig } from '@/lib/vorp-engine'

/**
 * THE LEAGUE'S REAL STARTING LINEUP, TYPED.
 *
 * 🛑 WHY THIS FILE EXISTS. `NormalizedLeagueContext.roster.starters` is imported per
 * league from Sleeper/ESPN/Yahoo and has always carried the truth — but it is typed
 * `unknown`, so no consumer could read it without a cast, and none did. The one place
 * that looked at it (`normalizeScoring`) squeezed out two booleans, `isSuperflex` and
 * `isTwoQB`, and dropped the rest on the floor.
 *
 * The cost of that landed in `buildRosterConfig` (lib/hybrid-valuation.ts), which falls
 * back to QB1/RB2/WR2/TE1 whenever no `rosterConfig` is supplied — which was always.
 * Replacement level is most of what a positional value IS, so every trade in the product
 * was priced against a default lineup: a 3-WR league and a 2-WR league got the same WR
 * numbers, and neither was right for anyone who did not happen to run the default.
 *
 * This module turns that array into counts, so the value can be league-specific and the
 * explanation can say "you start 3 WR" — the same fact serving the math and the sentence.
 */

export type RosterSlotCounts = {
  QB: number
  RB: number
  WR: number
  TE: number
  K: number
  DST: number
  /** W/R/T-style flex, EXCLUDING superflex — those are counted separately. */
  FLEX: number
  SUPER_FLEX: number
  /** Any individual-defensive-player slot: DL, LB, DB, IDP_FLEX, etc. */
  IDP: number
  /** Recognized as a starting slot but not mappable to the above. */
  OTHER: number
}

export type NormalizedRosterSlots = {
  schemaVersion: 1
  /** Starting slot labels in platform order, with bench/IR/taxi removed. */
  slots: string[]
  counts: RosterSlotCounts
  totalStarters: number
  superflex: boolean
  /**
   * False when the platform gave us nothing usable. A caller MUST NOT treat an
   * unresolved breakdown as a real lineup — the whole point of this module is to stop
   * a default masquerading as the league's own rules.
   */
  resolved: boolean
}

/** Slots that are not started, and so must not shift replacement level. */
const NON_STARTING = new Set([
  'BN', 'BE', 'BENCH', 'IR', 'TAXI', 'RES', 'RESERVE', 'NA', 'INJURY_RESERVE',
])

const SUPERFLEX_LABELS = new Set([
  'SUPER_FLEX', 'SUPERFLEX', 'SFLEX', 'SF', 'Q/W/R/T', 'QB/WR/RB/TE', 'OP',
])

const FLEX_LABELS = new Set([
  'FLEX', 'W/R/T', 'W/R', 'WR/RB', 'WR/RB/TE', 'WRRB_FLEX', 'REC_FLEX', 'WRTE_FLEX',
  'WR/TE', 'RB/WR', 'RB/WR/TE',
])

const DST_LABELS = new Set(['DEF', 'DST', 'D/ST', 'D', 'TEAM_DEF', 'DEFENSE'])
const K_LABELS = new Set(['K', 'PK', 'KICKER'])

const IDP_TOKENS = ['IDP', 'DL', 'LB', 'DB', 'DE', 'DT', 'CB', 'S', 'EDR', 'EDGE']

function emptyCounts(): RosterSlotCounts {
  return { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DST: 0, FLEX: 0, SUPER_FLEX: 0, IDP: 0, OTHER: 0 }
}

function classify(rawLabel: string, counts: RosterSlotCounts): void {
  const label = rawLabel.trim().toUpperCase()

  // ⚠ SUPERFLEX BEFORE QB, and FLEX before its components. 'Q/W/R/T' contains 'QB'-ish
  // tokens and 'W/R/T' contains 'WR'-ish ones; classifying by substring first would file
  // a superflex slot as a dedicated QB and overstate QB replacement level in exactly the
  // format where getting QBs right matters most.
  if (SUPERFLEX_LABELS.has(label)) { counts.SUPER_FLEX += 1; return }
  if (FLEX_LABELS.has(label)) { counts.FLEX += 1; return }
  if (DST_LABELS.has(label)) { counts.DST += 1; return }
  if (K_LABELS.has(label)) { counts.K += 1; return }

  if (label === 'QB') { counts.QB += 1; return }
  if (label === 'RB') { counts.RB += 1; return }
  if (label === 'WR') { counts.WR += 1; return }
  if (label === 'TE') { counts.TE += 1; return }

  if (IDP_TOKENS.some((token) => label === token || label.startsWith(`${token}_`))) {
    counts.IDP += 1
    return
  }

  // Loose fallbacks for platforms that decorate labels (e.g. 'QB_1', 'RB2').
  if (/^QB/.test(label)) { counts.QB += 1; return }
  if (/^RB/.test(label)) { counts.RB += 1; return }
  if (/^WR/.test(label)) { counts.WR += 1; return }
  if (/^TE/.test(label)) { counts.TE += 1; return }
  if (label.includes('FLEX')) { counts.FLEX += 1; return }

  counts.OTHER += 1
}

/**
 * Parse a platform starters array into a typed slot breakdown.
 *
 * Returns `resolved: false` — never a plausible-looking default — when the input is
 * absent or unusable, so a caller can tell "this league starts one QB" apart from
 * "we have no idea what this league starts".
 */
export function parseRosterSlots(starters: unknown): NormalizedRosterSlots {
  const raw = Array.isArray(starters) ? starters.map((x) => String(x)) : []
  const slots = raw.filter((label) => !NON_STARTING.has(label.trim().toUpperCase()))

  const counts = emptyCounts()
  for (const slot of slots) classify(slot, counts)

  const totalStarters = slots.length

  return {
    schemaVersion: 1,
    slots,
    counts,
    totalStarters,
    superflex: counts.SUPER_FLEX > 0,
    resolved: totalStarters > 0,
  }
}

/**
 * Convert a parsed lineup into the shape the VORP engine reads.
 *
 * ⚠ `startingFlex` INCLUDES superflex slots, matching the existing convention in
 * `buildRosterConfig` (`isSuperFlex ? 3 : 2` = two regular flex plus one superflex).
 * `computeReplacementThreshold` relies on it: it subtracts one flex slot when
 * `superflex` is set before sharing the rest among RB/WR/TE. Passing regular-flex-only
 * here would quietly delete a flex slot from every superflex league's replacement math.
 *
 * Returns null when the lineup was never resolved, so the caller keeps its existing
 * fallback rather than being handed a fabricated config.
 */
export function toLeagueRosterConfig(
  slots: NormalizedRosterSlots | null,
  numTeams: number,
): LeagueRosterConfig | null {
  if (!slots?.resolved) return null

  const { counts } = slots
  return {
    numTeams,
    startingQB: counts.QB,
    startingRB: counts.RB,
    startingWR: counts.WR,
    startingTE: counts.TE,
    startingFlex: counts.FLEX + counts.SUPER_FLEX,
    superflex: slots.superflex,
  }
}

/** "1 QB, 2 RB, 3 WR, 1 TE, 1 FLEX" — for explanations, not for math. */
export function describeRosterSlots(slots: NormalizedRosterSlots | null): string | null {
  if (!slots?.resolved) return null
  const { counts } = slots
  const parts: string[] = []
  const push = (n: number, label: string) => { if (n > 0) parts.push(`${n} ${label}`) }
  push(counts.QB, 'QB')
  push(counts.RB, 'RB')
  push(counts.WR, 'WR')
  push(counts.TE, 'TE')
  push(counts.FLEX, 'FLEX')
  push(counts.SUPER_FLEX, 'SUPERFLEX')
  push(counts.IDP, 'IDP')
  push(counts.K, 'K')
  push(counts.DST, 'DST')
  return parts.length > 0 ? parts.join(', ') : null
}
