/**
 * How a trade typed as prose splits into sides, and which words in it could be player names.
 *
 * Pure, with no imports, because the FantasyCalc price shortcut in `lib/ai/deterministic.ts` runs on
 * every chat message and needs to recognise a trade before it answers one. These lived in
 * `describedTradeEvaluator.ts`, whose imports reach the grader, the value engine and the projection
 * readers; that module re-exports them, so every existing import path still works and there is
 * still one splitter.
 */

/** A trade nobody would type: guards the name-candidate scan and the IN clauses built from it. */
export const MAX_NAME_CANDIDATES = 24

/**
 * The word that separates what you get from what you give. Ordered longest-first
 * so "in exchange for" wins over the "for" inside it.
 */
const SEPARATORS = [
  ' in exchange for ',
  ' straight up for ',
  ' traded for ',
  ' swap for ',
  ' for ',
  ' vs ',
  ' <-> ',
]

/**
 * Capitalised runs of 2–3 words — the shape a player's name takes in prose.
 *
 * Deliberately over-generates: every candidate is then checked against
 * `adp_data`, so a false candidate costs one row in an `IN` clause and nothing
 * else. Under-generating would silently drop a real player instead.
 */
export function extractPlayerNameCandidates(message: string): string[] {
  const out = new Set<string>()
  // Allow the internal punctuation real names carry: O'Dell, Amon-Ra, Jr., St.
  const tokens = message.match(/[A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+){1,2}/g) ?? []
  for (const t of tokens) {
    const cleaned = t.replace(/[.,!?]+$/, '').trim()
    if (cleaned.split(/\s+/).length >= 2) out.add(cleaned)
    if (out.size >= MAX_NAME_CANDIDATES) break
  }
  return [...out]
}

/**
 * Which half of the sentence a name appears in decides which side it is on.
 *
 * Shared by the described-trade grader, `lib/chimmy/tradeScenarioGrounding.ts` and
 * `lib/chimmy/tradeTargetQuestion.ts` — two splitters would disagree about the same sentence.
 */
export function splitSides(message: string): { left: string; right: string } | null {
  const lower = message.toLowerCase()
  for (const sep of SEPARATORS) {
    const at = lower.indexOf(sep)
    if (at > 0) {
      return { left: message.slice(0, at), right: message.slice(at + sep.length) }
    }
  }
  return null
}
