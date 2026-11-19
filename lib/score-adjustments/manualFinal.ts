/**
 * A commissioner marking one regular-season game FINAL by hand.
 *
 * WHY. A game goes final only when every starter's stat line is in and finalized, and the week
 * finalizer seals a whole week only once the league office's slate is over and the stats are there
 * (lib/redraft/weekFinalizer.ts). A commissioner had no way to say "this one game is over, at this
 * score": a league with no stat feed for its sport, a game settled by a ruling, or a week the
 * finalizer keeps refusing left the season unable to advance except by overriding the whole week
 * (found on the redraft walkthrough, 2026-11-18).
 *
 * ⚠ STORED BESIDE THE MATCHUP, NOT ONLY ON IT, for the reason score adjustments are
 * (./scoreAdjustments.ts): every rescore rewrites `RedraftMatchup.status` from the players' own
 * finalized flags, so a `final` written to the row alone would be `active` again at the next score
 * sync. The list lives in `League.settings.commissioner_final_matchups`; the scoring engine reads it
 * and leaves a listed game exactly as it stands: status, and score.
 *
 * A FINAL GAME'S SCORE IS FROZEN. Later stat syncs do not move it. To change it, the commissioner
 * adds a score adjustment (which works on a final game) or reopens the game.
 *
 * Pure.
 */
export const MANUAL_FINALS_KEY = 'commissioner_final_matchups'
export const MANUAL_FINAL_REASON_MIN = 3
export const MANUAL_FINAL_REASON_MAX = 200

export type ManualFinal = {
  matchupId: string
  week: number
  /** The score the game was closed at, for the audit trail. */
  homeScore: number
  awayScore: number
  reason: string
  byUserId: string
  at: string
}

function isManualFinal(x: unknown): x is ManualFinal {
  const f = x as Partial<ManualFinal> | null
  return Boolean(
    f && typeof f.matchupId === 'string' && f.matchupId && typeof f.week === 'number' &&
      typeof f.reason === 'string' && typeof f.byUserId === 'string' && typeof f.at === 'string',
  )
}

/** Every game a commissioner closed by hand. An unreadable entry is dropped rather than breaking a rescore. */
export function readManualFinals(settings: unknown): ManualFinal[] {
  const s = settings && typeof settings === 'object' ? (settings as Record<string, unknown>)[MANUAL_FINALS_KEY] : null
  return Array.isArray(s) ? s.filter(isManualFinal) : []
}

export function isManuallyFinal(list: readonly ManualFinal[], matchupId: string): boolean {
  return list.some((f) => f.matchupId === matchupId)
}

/** The trimmed reason, or null when it is too short or too long. */
export function parseManualFinalReason(raw: unknown): string | null {
  const reason = typeof raw === 'string' ? raw.trim() : ''
  return reason.length >= MANUAL_FINAL_REASON_MIN && reason.length <= MANUAL_FINAL_REASON_MAX ? reason : null
}
