/**
 * The value scale the waiver engine reasons on.
 *
 * ── 🛑 WHY A HEURISTIC SCALE IS THE RIGHT ANSWER HERE, AND A MARKET VALUE IS NOT ─────────────
 * `scoreWaiverCandidates` never reads a value in isolation. Every use is a DIFFERENCE between a
 * candidate and somebody already on the roster — `candidate.value - worstStarter.value` for the
 * replacement gain, the cheapest bench player for the drop nomination. So what the numbers must be
 * is COMMENSURABLE, not accurate. Pricing the roster off FantasyCalc while pricing the wire off a
 * positional baseline would put the two sides of every subtraction on different scales and quietly
 * corrupt the ranking — a worse failure than both sides being approximate together, because it
 * looks more authoritative.
 *
 * ⚠ SO THIS IS NOT A PLAYER VALUATION AND MUST NEVER BE SURFACED AS ONE. AllFantasy publishes real
 * market values (`lib/fantasycalc-db.ts`, and AF's own board); this is an internal ordering device
 * for one engine. Rendering these numbers to a user, or joining them against a market value, would
 * be reporting a placeholder as a price.
 *
 * ── WHY IT LIVES HERE AND NOT IN THE PAGE ───────────────────────────────────────────────────
 * It was defined inside `components/waiver-wire/WaiverWirePage.tsx`, which meant the scale existed
 * only in the browser — and the browser is the only thing that had ever assembled a waiver engine
 * input. The Decision OS grounding packet has to build the same input server-side to answer a
 * waiver question in chat, and a second copy of this table would be a second scale. One definition,
 * two callers.
 */

/**
 * Positional baseline, before any adjustment. Covers all seven sports.
 *
 * ⚠ THE NUMBERS ARE ORDINAL, NOT MONETARY. What is load-bearing is that RB sits above TE and a
 * kicker sits far below both — the spacing encodes positional scarcity for the depth maths, and
 * nothing downstream treats the units as anything.
 */
export const POSITION_BASE_VALUE: Record<string, number> = {
  QB: 2400,
  RB: 3000,
  WR: 2900,
  TE: 2200,
  K: 900,
  DEF: 1000,
  DST: 1000,
  PG: 2600,
  SG: 2500,
  SF: 2500,
  PF: 2500,
  C: 2650,
  SP: 2800,
  RP: 1800,
  P: 2600,
  G: 2400,
  F: 2400,
  UTIL: 2200,
  GKP: 1800,
  GK: 1800,
  MID: 2600,
  FWD: 2700,
  DM: 2200,
  DEFENDER: 2100,
}

/** Baseline for a position the table does not name — deliberately mid-pack, never zero. */
const UNKNOWN_POSITION_BASE = 2200

/**
 * A wire candidate's value: positional baseline, lifted by how hard the league is chasing them.
 *
 * ⚠ `trendScore` AND `watchlisted` ARE DEMAND SIGNALS, AND THEY ARE THE ONLY THING SEPARATING TWO
 * PLAYERS AT THE SAME POSITION. Without them every free-agent WR prices identically and the ranking
 * collapses to position order. A server-side caller with no trend data must pass 0 and accept that
 * flattening rather than substitute a different signal into the same argument.
 */
export function estimateWaiverCandidateValue(
  position: string | null,
  trendScore: number,
  watchlisted: boolean,
): number {
  const normalizedPosition = String(position ?? '').toUpperCase()
  const base = POSITION_BASE_VALUE[normalizedPosition] ?? UNKNOWN_POSITION_BASE
  const trendBoost = Math.max(0, trendScore) * 240
  const watchlistBoost = watchlisted ? 260 : 0
  return Math.round(base + trendBoost + watchlistBoost)
}

/**
 * A rostered player's value on the same scale, preferring a real one when the roster carries it.
 *
 * ⚠ THE FLOOR OF 200 IS DELIBERATE AND IS NOT A DEFAULT VALUE. A zero would make every candidate
 * an infinite upgrade over that player and would nominate them as the drop every time; 200 keeps a
 * genuinely worthless roster spot at the bottom of the ordering without pretending it is worth a
 * position baseline.
 */
export function rosterPlayerValue(
  position: string,
  carried: { value?: unknown; assetValue?: { marketValue?: unknown; impactValue?: unknown } } = {},
): number {
  const inferred =
    Number(
      carried.value ?? carried.assetValue?.marketValue ?? carried.assetValue?.impactValue ?? 0,
    ) || estimateWaiverCandidateValue(position, 0, false)
  return Math.max(200, Number.isFinite(inferred) ? Number(inferred) : 1200)
}
