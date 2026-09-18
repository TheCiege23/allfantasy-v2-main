/**
 * What actually moved between two payloads, and how long to say so.
 *
 * Every poll replaces the whole payload, so React re-renders every row with new
 * object identity and nothing on screen knows which number changed. The reader is
 * left to spot it themselves — on the one screen whose entire premise is that a
 * number just changed.
 *
 * Pure, outside the server-only loader, like `lockAlerts.ts` and
 * `connectionState.ts`.
 */

/** The shape this needs from a game card. `LiveGameCard` satisfies it. */
export type ScoreSnapshot = {
  gameId: string
  home: { score: number | null }
  away: { score: number | null }
}

export type SideChange = { from: number | null; to: number }

export type ScoreChange = {
  gameId: string
  home: SideChange | null
  away: SideChange | null
}

/** How long a changed score stays highlighted. */
export const FLASH_MS = 6_000

/**
 * Changes landing within this of each other share one end time.
 *
 * Without it, a poll that lands while a previous highlight is still fading starts
 * a second, offset animation — so two scores that changed a second apart pulse out
 * of step and the eye reads it as the page twitching rather than as news.
 */
export const COALESCE_MS = 2_000

function sideChange(from: number | null, to: number | null): SideChange | null {
  // Nothing to report when the feed stopped giving us a number. A real score does
  // not become unknown; this is a data regression, and flashing it would present
  // our own gap as an event.
  if (to == null) return null

  /*
   * ⚠ null -> 0 IS A KICKOFF, NOT A SCORE. Before a game starts `score` is null
   * rather than 0 — deliberately, because ESPN sends "0" for both sides of a
   * fixture that has not started and the loader refuses to render that as 0-0.
   * So the first payload after kickoff moves both sides null -> 0, and treating
   * that as a change would flash every game on the slate the moment it began,
   * announcing points nobody scored.
   */
  if (from == null) return to > 0 ? { from, to } : null

  if (from === to) return null

  /*
   * ⚠ A DECREASE IS REPORTED TOO. Scores go down: a touchdown gets reviewed and
   * reversed, a stat correction lands. That is exactly the moment a manager wants
   * to be told something moved, and filtering to increases would hide the
   * surprising half of the news.
   */
  return { from, to }
}

/**
 * Score changes between two payloads.
 *
 * ⚠ RETURNS NOTHING WHEN THERE IS NO PREVIOUS PAYLOAD, AND THAT IS THE POINT. On
 * first paint every score is "new", so diffing against nothing would light up the
 * entire slate the instant the page opens — the precise visual noise this exists
 * to remove. A game appearing for the first time mid-session is treated the same
 * way: the card arriving IS the event, and flashing it as well says a score
 * changed when none did.
 */
export function diffScores(
  prev: readonly ScoreSnapshot[] | null,
  next: readonly ScoreSnapshot[],
): ScoreChange[] {
  if (prev == null) return []

  const before = new Map(prev.map((g) => [g.gameId, g]))
  const out: ScoreChange[] = []

  for (const game of next) {
    const was = before.get(game.gameId)
    if (!was) continue // new card this poll; see the note above

    const home = sideChange(was.home.score, game.home.score)
    const away = sideChange(was.away.score, game.away.score)
    if (home || away) out.push({ gameId: game.gameId, home, away })
  }

  return out
}

/**
 * Fold new changes into the highlights already running.
 *
 * ⚠ NEAR-SIMULTANEOUS CHANGES SHARE ONE END TIME. That is the whole of the
 * batching: highlights that began within `COALESCE_MS` of each other fade together
 * instead of staggering, so a burst of scoring reads as one update rather than as
 * the page flickering several times in a row.
 *
 * Expiry is extended, never shortened — a score that changes twice in quick
 * succession stays lit for the full window after the SECOND change rather than
 * going dark early because the first one was about to end.
 */
export function mergeFlashes(
  existing: ReadonlyMap<string, number>,
  changes: readonly ScoreChange[],
  now: number,
  opts: { flashMs?: number; coalesceMs?: number } = {},
): Map<string, number> {
  const flashMs = opts.flashMs ?? FLASH_MS
  const coalesceMs = opts.coalesceMs ?? COALESCE_MS

  // Drop anything already finished, so the map cannot grow for a whole afternoon.
  const next = new Map<string, number>()
  for (const [gameId, expiresAt] of existing) {
    if (expiresAt > now) next.set(gameId, expiresAt)
  }

  if (changes.length === 0) return next

  const fresh = now + flashMs

  /*
   * Highlights already running that started close enough to this one to be the
   * same burst. They are pulled UP to the shared end time below.
   *
   * ⚠ MOVING ONLY THE NEW ONES IS NOT COALESCING, AND THAT IS WHAT THIS FIRST
   * SHIPPED AS. Setting the incoming change to a shared end while leaving the
   * running ones on their own expiries produces exactly the staggered fade the
   * batching is supposed to remove — two highlights ending a second apart, which
   * is the page twitching twice rather than one piece of news.
   */
  const burst: string[] = []
  let end = fresh
  for (const [gameId, expiresAt] of next) {
    if (Math.abs(expiresAt - fresh) <= coalesceMs) {
      burst.push(gameId)
      if (expiresAt > end) end = expiresAt
    }
  }

  for (const gameId of burst) next.set(gameId, end)

  for (const change of changes) {
    const current = next.get(change.gameId)
    // Extended, never shortened: a second change keeps the longer of the two.
    next.set(change.gameId, current != null && current > end ? current : end)
  }

  return next
}

/** Game ids still highlighted at `now`. */
export function activeFlashes(flashes: ReadonlyMap<string, number>, now: number): Set<string> {
  const out = new Set<string>()
  for (const [gameId, expiresAt] of flashes) {
    if (expiresAt > now) out.add(gameId)
  }
  return out
}
