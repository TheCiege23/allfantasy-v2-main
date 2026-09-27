/** Shared history is memory, not a queue of unanswered tasks. */
export const CHIMMY_CURRENT_REQUEST_POLICY =
  'Answer only the CURRENT user request. Earlier conversation turns are memory: use them to resolve references or follow-ups in the current request, but do not reopen unrelated old or unanswered questions. League names appearing only in history are not requests to select those leagues. Keep the selected league as the default for facts and tools; select another league only when the current request asks about it. Cross-league checks are appropriate only when the current request asks for them, or no league is selected. Never combine an old trade question with a new roster review unless the current request asks for both.' +
  ' Current tool and Decision OS evidence takes precedence over earlier assistant claims. Use the supplied current roster and injury counts; do not reuse counts from conversation history or infer that players without reports are healthy. Distinguish hypothetical optimized projections from the provider\'s stored lineup projection and actual scores.'

export function currentRequestFocus(leagueId: string | null): string {
  return `${CHIMMY_CURRENT_REQUEST_POLICY}\nCurrent selected league: ${leagueId || 'none (account-wide context)'}.`
}
