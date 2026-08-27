/**
 * Which manager on one platform is which manager on the other.
 *
 * A C2C franchise runs on two platforms with two sets of usernames, and they do
 * not have to look alike. This infers the pairing from behaviour rather than
 * from names.
 *
 * ── Why trades, and not rosters ─────────────────────────────────────────────
 *
 * ⚠ NO PLAYER ID SURVIVES THE COLLEGE-TO-PRO TRANSITION. Measured 2026-08-26 by
 * intersecting Fantrax's own CFB and NFL maps:
 *
 *     sportRadarId  nfl 7,310  cfb 15,915  shared 0
 *     rotowireId    nfl 6,442  cfb  3,343  shared 0
 *     statsIncId    nfl 3,750  cfb    198  shared 0
 *     fantraxId     nfl 8,646  cfb 16,886  shared 0
 *
 * Zero on every space, including Fantrax's own. So "he held this player in
 * college and holds him in the pros" cannot be keyed — it can only be matched by
 * name, which is the join this codebase keeps getting burned by. 995 players
 * share a name across those maps and not one shares an id.
 *
 * A TRADE NEEDS NO CROSS-BOUNDARY KEY. It is a timestamped event between two
 * managers, entirely inside one platform's own id space. Matching a Fantrax
 * trade to its Sleeper mirror pins TWO pairings at once — if F1↔S1 then F2↔S2 —
 * which is a far stronger constraint than any single-sided observation, and much
 * harder to produce by coincidence.
 *
 * ── What this deliberately does not do ─────────────────────────────────────
 *
 * ⚠ IT PROPOSES, IT NEVER MERGES. A wrong identity merge hands one manager
 * another's franchise, so every result carries its evidence and a confidence,
 * and a human confirms. Nothing here writes.
 *
 * ⚠ AND AN UNMATCHED TRADE IS NORMAL, NOT A FAILURE. The two leagues trade
 * independently: a college-only deal has no pro mirror and never will. Treating
 * unmatched as evidence of anything would punish leagues that simply trade on
 * one side.
 */

/** One side of a deal, as that platform records it. */
export type PlatformTrade = {
  /** Platform-native id, for reporting only. */
  id: string
  /** When the platform says it completed. */
  at: Date
  /**
   * The managers involved, as platform-native identifiers (roster id, team id,
   * username — whatever that platform is keyed on). Order is not meaningful.
   */
  participants: string[]
}

export type IdentityCandidate = {
  /** Fantrax-side participant identifier. */
  college: string
  /** Sleeper-side participant identifier. */
  pro: string
  /** How many matched trades support this pairing. */
  support: number
  /**
   * How many matched trades CONTRADICT it — the same college id paired with a
   * different pro id in another match.
   *
   * ⚠ CONTRADICTION IS NOT ABSENCE. A pairing seen four times and contradicted
   * three is not a strong pairing, and averaging that away is how a confident
   * wrong answer gets made.
   */
  conflicts: number
  confidence: 'high' | 'moderate' | 'low'
  /** Human-readable evidence, one line per supporting match. */
  evidence: string[]
}

export type InferenceResult = {
  candidates: IdentityCandidate[]
  matchedTrades: number
  /** Trades on either side with no counterpart. Expected, not a problem. */
  unmatchedCollege: number
  unmatchedPro: number
  gaps: string[]
}

export const IDENTITY_GAPS = {
  noFantraxTradeApi:
    'Fantrax exposes no transactions endpoint — its trades are only available from the league CSV export, so this can only run on leagues where one has been uploaded',
  proposalOnly:
    'these are proposals with their evidence, never an automatic merge: a wrong identity match hands one manager another franchise',
  singleMatch:
    'a pairing supported by a single trade on a single day is a coincidence as often as it is a fact — treat it as a lead, not an answer',
} as const

/**
 * How far apart two platforms may record the same deal and still be the same
 * deal.
 *
 * ⚠ NOT ZERO, AND NOT GENEROUS. The two halves are executed by hand on separate
 * sites, so they land minutes or hours apart, and a manager may do the second
 * leg the next morning. Widening this past a couple of days starts matching
 * unrelated deals in an active league, which manufactures pairings.
 */
export const DEFAULT_WINDOW_HOURS = 48

function hoursApart(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / 3_600_000
}

/**
 * Pair managers across platforms from trades that mirror each other.
 *
 * A match requires the two trades to be close in time and to involve the same
 * NUMBER of participants — a two-team deal cannot mirror a three-team one.
 */
export function inferIdentitiesFromTrades(args: {
  collegeTrades: PlatformTrade[]
  proTrades: PlatformTrade[]
  windowHours?: number
}): InferenceResult {
  const windowHours = args.windowHours ?? DEFAULT_WINDOW_HOURS
  const gaps: string[] = [IDENTITY_GAPS.proposalOnly, IDENTITY_GAPS.noFantraxTradeApi]

  /** college|pro -> supporting evidence lines */
  const pairs = new Map<string, string[]>()
  const matchedCollege = new Set<string>()
  const matchedPro = new Set<string>()
  let matchedTrades = 0

  for (const c of args.collegeTrades) {
    for (const p of args.proTrades) {
      if (c.participants.length !== p.participants.length) continue
      const gap = hoursApart(c.at, p.at)
      if (gap > windowHours) continue

      /*
       * ⚠ ONLY TWO-TEAM DEALS ARE PAIRED. With three or more sides the
       * assignment between them is ambiguous — several pairings fit the same
       * pair of trades — and picking one would be a guess dressed as evidence.
       */
      if (c.participants.length !== 2) continue

      matchedTrades++
      matchedCollege.add(c.id)
      matchedPro.add(p.id)

      /*
       * Both orderings are recorded because the platforms do not agree on which
       * side is "first". The contradiction count below is what sorts out which
       * orientation is real: the correct one recurs, the mirrored one does not.
       */
      const line = `${c.at.toISOString().slice(0, 10)}: college trade ${c.id} and pro trade ${p.id} completed ${Math.round(gap)}h apart`
      for (const [ci, pi] of [
        [0, 0],
        [1, 1],
      ] as const) {
        const key = `${c.participants[ci]}|${p.participants[pi]}`
        pairs.set(key, [...(pairs.get(key) ?? []), line])
      }
      for (const [ci, pi] of [
        [0, 1],
        [1, 0],
      ] as const) {
        const key = `${c.participants[ci]}|${p.participants[pi]}`
        pairs.set(key, [...(pairs.get(key) ?? []), line])
      }
    }
  }

  /* Conflicts: the same college id proposed against more than one pro id. */
  const byCollege = new Map<string, number>()
  for (const key of pairs.keys()) {
    const college = key.split('|')[0]
    byCollege.set(college, (byCollege.get(college) ?? 0) + 1)
  }

  const candidates: IdentityCandidate[] = [...pairs.entries()].map(([key, evidence]) => {
    const [college, pro] = key.split('|')
    const conflicts = (byCollege.get(college) ?? 1) - 1
    return {
      college,
      pro,
      support: evidence.length,
      conflicts,
      confidence: scoreConfidence(evidence.length, conflicts),
      evidence,
    }
  })

  /* Strongest first: most support, then fewest competing explanations. */
  candidates.sort((a, b) => b.support - a.support || a.conflicts - b.conflicts)

  if (candidates.some((c) => c.support === 1)) gaps.push(IDENTITY_GAPS.singleMatch)

  return {
    candidates,
    matchedTrades,
    unmatchedCollege: args.collegeTrades.filter((t) => !matchedCollege.has(t.id)).length,
    unmatchedPro: args.proTrades.filter((t) => !matchedPro.has(t.id)).length,
    gaps,
  }
}

/**
 * ⚠ SUPPORT ALONE IS NOT CONFIDENCE. Every matched trade proposes both the real
 * pairing and its mirror image, so a pairing with support 3 and three competing
 * explanations knows nothing. Confidence is how far a pairing stands ABOVE its
 * rivals, not how often it was seen.
 */
function scoreConfidence(support: number, conflicts: number): IdentityCandidate['confidence'] {
  if (support >= 3 && conflicts <= 1) return 'high'
  if (support >= 2 && conflicts <= 2) return 'moderate'
  return 'low'
}

/**
 * The pairings worth showing a human, one per college manager.
 *
 * ⚠ RETURNS NOTHING FOR A MANAGER WHOSE BEST TWO CANDIDATES ARE TIED. A tie
 * means the trades cannot tell them apart, and presenting the first one as the
 * answer would be arbitrary — the evidence is genuinely silent.
 */
export function bestIdentityMatches(result: InferenceResult): IdentityCandidate[] {
  const byCollege = new Map<string, IdentityCandidate[]>()
  for (const c of result.candidates) {
    byCollege.set(c.college, [...(byCollege.get(c.college) ?? []), c])
  }

  const out: IdentityCandidate[] = []
  for (const list of byCollege.values()) {
    const sorted = [...list].sort((a, b) => b.support - a.support)
    if (sorted.length === 1) {
      out.push(sorted[0])
      continue
    }
    if (sorted[0].support > sorted[1].support) out.push(sorted[0])
    /* Tied: say nothing rather than pick one. */
  }
  return out.sort((a, b) => b.support - a.support)
}
