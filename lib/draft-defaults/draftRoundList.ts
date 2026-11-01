/**
 * The one normaliser for a draft's college-only round list — `DraftSession.devyConfig.devyRounds`
 * and `DraftSession.c2cConfig.collegeRounds` — shared by every path that writes one:
 *
 *   - PATCH /api/leagues/:id/draft/settings (Settings › Draft, `sessionVariant`) via
 *     DraftVariantSettingsHub.updateSessionVariant
 *   - PATCH /api/leagues/:id/draft/devy/config (the draft room's commissioner panel)
 *   - PATCH /api/leagues/:id/draft/c2c/config (the same panel, C2C)
 *
 * Pure (no Prisma), so a route can import it without pulling the hub — several suites mock the hub
 * module with only the two functions they use.
 *
 * Why the rule is shaped like this: the pick check (PickSubmissionService →
 * validateDevyEligibilityAsync / validateC2CEligibilityAsync) matches the current round with
 * `Array.includes`, so only a whole NUMBER can ever match, and a round past the draft's last round
 * never comes up. A stored `2.5`, `"3"`, `0` or `20`-in-a-15-round-draft is therefore a round the
 * settings appear to name and the engine never enforces. Out-of-range and fractional entries are
 * DROPPED rather than clamped or rounded: clamping `20` to `15` would invent a college-only round 15
 * nobody asked for.
 */

/** Hard ceiling, matching `draft_rounds`' own clamp in DraftVariantSettingsHub.updateDraftConfigForLeague. */
export const MAX_DRAFT_ROUNDS = 50

function roundCap(maxRound: unknown): number {
  const n = typeof maxRound === 'number' ? maxRound : Number.NaN
  if (!Number.isInteger(n) || n < 1) return MAX_DRAFT_ROUNDS
  return Math.min(n, MAX_DRAFT_ROUNDS)
}

function toRound(value: unknown): number | null {
  if (typeof value === 'number') return Number.isInteger(value) ? value : null
  // A numeric string from a form field ("3") is accepted and stored as the number, so the engine's
  // Array.includes then matches it. Anything else (true, "", "abc", null) is not a round.
  if (typeof value === 'string' && /^\s*\d+\s*$/.test(value)) return Number(value)
  return null
}

/**
 * Whole rounds between 1 and `maxRound` (the draft's round count; 50 when unknown), each once,
 * ascending. Anything else in the input is dropped.
 */
export function sanitizeRoundList(input: unknown, maxRound?: number | null): number[] {
  if (!Array.isArray(input)) return []
  const cap = roundCap(maxRound)
  const rounds = new Set<number>()
  for (const raw of input) {
    const r = toRound(raw)
    if (r != null && r >= 1 && r <= cap) rounds.add(r)
  }
  return Array.from(rounds).sort((a, b) => a - b)
}

/**
 * The refusal for "on, with no round listed". The pick check reads that config as "every round is
 * pro-only": a devy / C2C draft that can never take a college player. Turning the rule off is the
 * explicit way to say that, so an enabled empty list is refused on every save path instead of being
 * stored. (`validateLeagueSettings` refuses it on Settings › Draft with its own wording.)
 */
export function emptyCollegeRoundsError(kind: 'devy' | 'c2c', maxRound?: number | null): string {
  const cap = roundCap(maxRound)
  return kind === 'devy'
    ? `Devy rounds are on but no valid round is listed. Add at least one round from 1 to ${cap}, or turn devy rounds off.`
    : `C2C college rounds are on but no valid round is listed. Add at least one round from 1 to ${cap}, or turn C2C college rounds off.`
}
