/** A selected-league review must reach roster grounding, even when it mentions injuries. */
export function isScopedRosterReviewQuestion(message: string, leagueRequested: boolean): boolean {
  return leagueRequested && /\b(?:review|assess|audit|analy[sz]e|evaluate|check)\b/i.test(message)
    && /\b(?:my|our)\b[\s\S]*\b(?:roster|lineup|team)\b/i.test(message)
}
