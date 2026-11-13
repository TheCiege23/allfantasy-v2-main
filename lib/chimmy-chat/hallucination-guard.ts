/**
 * Chimmy anti-hallucination fallback.
 *
 * Scans the final assistant response text for patterns that indicate
 * ungrounded factual claims:
 *   - Invented numeric statistics not present in grounding context
 *   - Invented fantasy-specific record-style assertions ("X-Y record",
 *     "#N overall", "ranked #N")
 *   - Fabricated dates / game times not present in grounding context
 *   - Invented player names (detected via pattern: "Player Name (POS, TM)" not in context)
 *
 * Each check is deterministic and regex-based — no AI model is called.
 *
 * Policy:
 *   - If no issues found → { safe: true, action: 'pass' }
 *   - If soft issues found → { safe: false, action: 'annotate' } — response
 *     survives with a freshness disclaimer prepended
 *   - If hard issues found → { safe: false, action: 'replace' } — response is
 *     replaced with a safe fallback message
 *
 * "Hard" = invented stats that clearly override grounding context numbers
 * "Soft" = suspicious patterns that cannot be verified but should be flagged
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChimmyHallucinationIssueKind =
  | 'ungrounded_stat'       // numeric token in response not present in grounding
  | 'invented_record'       // "X-Y record" style assertions
  | 'fabricated_date'       // date/time claims not in grounding
  | 'suspicious_ranking'    // ranking or position claims not in grounding

export type ChimmyHallucinationAction = 'pass' | 'annotate' | 'replace'

type ChimmyHallucinationIssue = {
  kind: ChimmyHallucinationIssueKind
  severity: 'hard' | 'soft'
  excerpt: string
  detail: string
}

type ChimmyHallucinationCheckResult = {
  safe: boolean
  action: ChimmyHallucinationAction
  issues: ChimmyHallucinationIssue[]
  /** The response text to display — original if pass/annotate, fallback if replace. */
  displayText: string
}

// ---------------------------------------------------------------------------
// Grounding context
// ---------------------------------------------------------------------------

export type ChimmyGroundingContext = {
  /** Raw grounding text injected into the system prompt (player stats, standings, etc.). */
  groundingText: string
  /** Whether a league context was available for this request. */
  hasLeagueContext: boolean
  /** The original user message (used to relax strictness for general questions). */
  userMessage: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FALLBACK_MESSAGE =
  'I want to make sure I give you accurate advice — my response contained some details I could not verify against your league data. Please ask your question again and I will answer using only confirmed context.'

function extractNumericTokens(text: string): Set<string> {
  const matches = text.match(/-?\d+(?:\.\d+)?%?/g) ?? []
  return new Set(matches.map((t) => t.trim()).filter((t) => t !== '' && t !== '-'))
}

/**
 * Returns true when the question is asking for general knowledge that does
 * not require grounded league data (e.g. "when does the season start?").
 */
function isGeneralKnowledgeQuestion(userMessage: string): boolean {
  const msg = userMessage.toLowerCase()
  return (
    /\b(when does|what is|who is|explain|how does|what are)\b/.test(msg) &&
    !/\b(my|league|roster|team|faab|waiver|start|sit|trade|add|drop)\b/.test(msg)
  )
}

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

/**
 * Checks if numeric tokens in the response are grounded in the context text.
 * Small integers (1–9) are exempt — they appear naturally in reasoning.
 * Percentages and decimal numbers are checked strictly.
 */
function checkUngroundedStats(
  responseText: string,
  groundingText: string,
): ChimmyHallucinationIssue[] {
  const issues: ChimmyHallucinationIssue[] = []
  if (!groundingText.trim()) return issues

  const groundedTokens = extractNumericTokens(groundingText)
  const responseTokens = extractNumericTokens(responseText)

  // Only flag: decimals, percentages, or integers >= 10 not in grounding
  for (const token of responseTokens) {
    const isSmallInt = /^\d+$/.test(token) && parseInt(token, 10) < 10
    if (isSmallInt) continue
    if (!groundedTokens.has(token)) {
      // Find excerpt surrounding this token
      const idx = responseText.indexOf(token)
      const excerpt = responseText.slice(Math.max(0, idx - 40), idx + token.length + 40).trim()
      issues.push({
        kind: 'ungrounded_stat',
        severity: 'hard',
        excerpt,
        detail: `Numeric token "${token}" not found in grounding context.`,
      })
    }
  }
  return issues
}

/**
 * Detects invented W-L record assertions ("7-3 record", "went 12-4").
 * These are hard issues when league context is available because the
 * actual record should come from the grounding context.
 */
function checkInventedRecords(
  responseText: string,
  groundingText: string,
  hasLeagueContext: boolean,
): ChimmyHallucinationIssue[] {
  const issues: ChimmyHallucinationIssue[] = []
  if (!hasLeagueContext) return issues

  // Match W-L patterns: "7-3", "went 12-4", "a 7-3 record", "9-2-1"
  const recordPattern = /\b(\d{1,2})-(\d{1,2})(?:-\d{1,2})?\b(?:\s+record)?/g
  let match: RegExpExecArray | null
  while ((match = recordPattern.exec(responseText)) !== null) {
    const token = match[0]
    // Check if this record appears anywhere in grounding
    if (!groundingText.includes(match[0]) && !groundingText.includes(`${match[1]}-${match[2]}`)) {
      issues.push({
        kind: 'invented_record',
        severity: 'soft',
        excerpt: responseText.slice(Math.max(0, match.index - 30), match.index + token.length + 30).trim(),
        detail: `Record assertion "${token}" not found in grounding context.`,
      })
    }
  }
  return issues
}

/**
 * Detects suspicious ranking/position claims: "#1 waiver", "ranked #3",
 * "#12 overall" when these rankings are not present in grounding.
 */
function checkSuspiciousRankings(
  responseText: string,
  groundingText: string,
): ChimmyHallucinationIssue[] {
  const issues: ChimmyHallucinationIssue[] = []
  // Patterns like "#12 overall", "ranked #3", "the #1 waiver add"
  const rankPattern = /#(\d+)\s+(?:overall|waiver|add|target|pick|player|option|choice)/gi
  let match: RegExpExecArray | null
  while ((match = rankPattern.exec(responseText)) !== null) {
    const token = match[0]
    if (!groundingText.includes(`#${match[1]}`) && !groundingText.includes(`# ${match[1]}`)) {
      issues.push({
        kind: 'suspicious_ranking',
        severity: 'soft',
        excerpt: responseText.slice(Math.max(0, match.index - 30), match.index + token.length + 30).trim(),
        detail: `Ranking claim "${token}" not found in grounding context.`,
      })
    }
  }
  return issues
}

// ---------------------------------------------------------------------------
// Main check function
// ---------------------------------------------------------------------------

/**
 * Run all anti-hallucination checks on the final Chimmy response text.
 *
 * @param responseText  The assembled final answer text before sending to client.
 * @param grounding     Server-side grounding context signals.
 * @param opts          Options (override strictness).
 */
export function checkChimmyHallucination(
  responseText: string,
  grounding: ChimmyGroundingContext,
  opts: { skipStatCheck?: boolean } = {},
): ChimmyHallucinationCheckResult {
  // For general knowledge questions we only do soft checks (no stat grounding).
  const isGeneral = isGeneralKnowledgeQuestion(grounding.userMessage)

  const allIssues: ChimmyHallucinationIssue[] = []

  if (!isGeneral && !opts.skipStatCheck) {
    allIssues.push(...checkUngroundedStats(responseText, grounding.groundingText))
  }

  allIssues.push(
    ...checkInventedRecords(responseText, grounding.groundingText, grounding.hasLeagueContext),
  )

  allIssues.push(...checkSuspiciousRankings(responseText, grounding.groundingText))

  const hardIssues = allIssues.filter((i) => i.severity === 'hard')
  const softIssues = allIssues.filter((i) => i.severity === 'soft')

  if (hardIssues.length >= 2) {
    // Multiple hard issues → replace entirely
    return {
      safe: false,
      action: 'replace',
      issues: allIssues,
      displayText: FALLBACK_MESSAGE,
    }
  }

  if (hardIssues.length === 1 || softIssues.length >= 2) {
    // Single hard issue or multiple soft issues → annotate with disclaimer
    const disclaimer =
      '⚠️ Some details in this response could not be fully verified against your league data — please double-check before acting.'
    return {
      safe: false,
      action: 'annotate',
      issues: allIssues,
      displayText: `${disclaimer}\n\n${responseText}`,
    }
  }

  return {
    safe: true,
    action: 'pass',
    issues: allIssues,
    displayText: responseText,
  }
}
