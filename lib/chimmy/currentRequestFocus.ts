/** Shared history is memory, not a queue of unanswered tasks. */
export const CHIMMY_CURRENT_REQUEST_POLICY =
  'Answer only the CURRENT user request. Earlier conversation turns are memory: use them to resolve references or follow-ups in the current request, but do not reopen unrelated old or unanswered questions. League names appearing only in history are not requests to select those leagues. Keep the selected league as the default for facts and tools; select another league only when the current request asks about it. Cross-league checks are appropriate only when the current request asks for them, or no league is selected. Never combine an old trade question with a new roster review unless the current request asks for both.' +
  ' Current tool and Decision OS evidence takes precedence over earlier assistant claims. Use the supplied current roster and injury counts; do not reuse counts from conversation history or infer that players without reports are healthy. Distinguish hypothetical optimized projections from the provider\'s stored lineup projection and actual scores. Stored starter placement or an injury list is not proof that a lineup change is still allowed. If kickoff locks and provider eligibility were not checked, disclose that before suggesting an actionable swap. ACT and INACT are roster activity states, not injury designations.' +
  ' Only the CURRENT request can carry an image, and only when SCREENSHOT EVIDENCE appears for it. An earlier turn that mentions a screenshot refers to an image that is no longer available; never tell the user they attached an image to the current request, and never ask them to retype one, unless that evidence is present.'

export function currentRequestFocus(leagueId: string | null): string {
  return `${CHIMMY_CURRENT_REQUEST_POLICY}\nCurrent selected league: ${leagueId || 'none (account-wide context)'}.`
}

/**
 * Marks history turns that carried an image. The drawer replays only a turn's TEXT, so an image turn
 * arrives as "Screenshot: IMG_1234.png" or "[image-only request]" with nothing behind it — and the
 * model, reading that beside a new question, concluded the new question had an image it could not
 * see (2026-09-30: "I also can't see the image you attached"). The marker says it plainly.
 */
const IMAGE_TURN = /^(?:Screenshot: .+|\[image-only request\])$/

export const EARLIER_IMAGE_NOTE = '(an image was attached to this earlier message; it is not available now)'

export function markEarlierImageTurns<T extends { role: string; content: string }>(turns: readonly T[]): T[] {
  return turns.map((t) =>
    t.role === 'user' && IMAGE_TURN.test(t.content.trim()) && !t.content.includes(EARLIER_IMAGE_NOTE)
      ? { ...t, content: `${t.content.trim()} ${EARLIER_IMAGE_NOTE}` }
      : t,
  )
}
