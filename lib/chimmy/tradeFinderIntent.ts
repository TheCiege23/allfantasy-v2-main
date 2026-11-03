/** Keep the user's package constraint on both the deterministic and tool-loop paths. */
export function requestsPickTradePackage(question: string): boolean {
  return /\b(?:trades?|offers?|packages?)\b/i.test(question) &&
    /\b(?:draft\s+picks?|future\s+picks?|(?:my|our)\s+picks?|(?:my|our)\s+(?:20\d{2}\s+)?(?:1st|2nd|3rd|first|second|third)|(?:1st|2nd|3rd|first|second|third)(?:[ -]round)?\s+picks?)\b/i.test(question)
}
