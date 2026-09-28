/** A selected-league review must reach roster grounding, even when it mentions injuries. */
export function isScopedRosterReviewQuestion(message: string, leagueRequested: boolean): boolean {
  const explicitlyAcrossLeagues = /\bacross\s+(?:[\w'-]+\s+){0,6}leagues\b|\b(?:all|both|every|multiple)\s+(?:[\w'-]+\s+){0,5}(?:leagues|rosters|teams|lineups)\b/i.test(message)
  return leagueRequested && !explicitlyAcrossLeagues
    && /\b(?:review|assess|audit|analy[sz]e|evaluate|check|count|summari[sz]e|explain|compare|break\s+down|how\s+many)\b/i.test(message)
    && /\b(?:my|our)\b[\s\S]*\b(?:rosters?|lineups?|teams?)\b/i.test(message)
}
