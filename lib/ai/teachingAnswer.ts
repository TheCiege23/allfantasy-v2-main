/**
 * TeachingAnswer — Chimmy's structured response format.
 *
 * Every premium AI answer should teach the user something, not just give a pick.
 * This format makes AllFantasy feel different from generic ChatGPT: the user
 * leaves smarter, not just informed.
 *
 * ── Format ─────────────────────────────────────────────────────────────────────
 * QUICK:
 * [1-2 sentences — the direct answer, immediately actionable]
 *
 * WHY:
 * [1-2 sentences — why this answer matters to the user's pool position]
 *
 * EDGE:
 * [1-2 sentences — the strategic insight that separates sharp from casual]
 *
 * AVOID:
 * [1 sentence — the mistake most casual players make here] (optional)
 *
 * CONFIDENCE: 0.8
 *
 * ── Notes ──────────────────────────────────────────────────────────────────────
 * - parseTeachingAnswer is intentionally fuzzy — it handles minor LLM
 *   formatting variations (extra whitespace, lowercase labels, etc.).
 * - buildTeachingSystemSuffix appends to existing system prompts without
 *   replacing them — the grounding/safety contract stays intact.
 */

// ─── Type ─────────────────────────────────────────────────────────────────────

type TeachingAnswer = {
  /** The direct answer in 1-2 sentences. Always present. */
  quickAnswer: string
  /** Why this answer matters for the user's pool/league position. */
  whyItMatters: string
  /** The strategic insight — what separates sharp from casual. */
  theEdge: string
  /** Mistake to avoid. Optional — omit for straightforward answers. */
  mistakeToAvoid?: string
  /** 0–1 confidence from the LLM's own assessment. */
  confidence: number
  /** Optional next action prompt for the user. */
  nextAction?: string
  /** Which data sources were used (from grounding context). */
  dataUsed: string[]
}

// ─── System prompt suffix ─────────────────────────────────────────────────────

/**
 * Append this to any Chimmy system prompt to request TeachingAnswer format.
 *
 * Safe to append — does not override grounding/safety instructions above it.
 * Only affects response format, not the data the LLM is allowed to use.
 */
export function buildTeachingSystemSuffix(): string {
  return [
    "",
    "── RESPONSE FORMAT ────────────────────────────────────────────────────────",
    "Structure your response using these exact labels (one section per line):",
    "QUICK: [1-2 sentences — the direct answer]",
    "WHY: [1-2 sentences — why it matters for their pool position]",
    "EDGE: [1-2 sentences — the strategic insight]",
    "AVOID: [1 sentence — the mistake to avoid] (omit section if not applicable)",
    "CONFIDENCE: [number between 0.0 and 1.0]",
    "Plain text only. No markdown. No bullet points inside sections.",
    "────────────────────────────────────────────────────────────────────────────",
  ].join("\n")
}

// ─── Parser ───────────────────────────────────────────────────────────────────

const SECTION_LABELS = {
  QUICK: /^QUICK\s*:/i,
  WHY: /^WHY\s*:/i,
  EDGE: /^EDGE\s*:/i,
  AVOID: /^AVOID\s*:/i,
  CONFIDENCE: /^CONFIDENCE\s*:/i,
}

/**
 * Extract a labeled section value from the raw LLM text.
 * Returns the text after the first matching label, up to (but not including)
 * the next label.
 */
function extractSection(text: string, label: RegExp): string | null {
  const lines = text.split("\n")
  const startIndex = lines.findIndex((l) => label.test(l.trim()))
  if (startIndex === -1) return null

  const labelLine = lines[startIndex].trim()
  // Value may be on same line after colon, or on subsequent lines
  const afterColon = labelLine.replace(label, "").replace(/^:?\s*/, "").trim()

  const sectionLines: string[] = afterColon ? [afterColon] : []
  for (let i = startIndex + 1; i < lines.length; i++) {
    // Stop at next label
    const isNextLabel = Object.values(SECTION_LABELS).some((re) => re.test(lines[i].trim()))
    if (isNextLabel) break
    const line = lines[i].trim()
    if (line) sectionLines.push(line)
  }

  return sectionLines.join(" ").replace(/\s+/g, " ").trim() || null
}

/**
 * Parse a TeachingAnswer from raw LLM text.
 *
 * Returns null if the text doesn't contain the required QUICK/WHY/EDGE sections.
 * Partial structures (missing AVOID or CONFIDENCE) are returned with defaults.
 */
export function parseTeachingAnswer(
  text: string,
  opts?: { dataUsed?: string[] }
): TeachingAnswer | null {
  const quickAnswer = extractSection(text, SECTION_LABELS.QUICK)
  const whyItMatters = extractSection(text, SECTION_LABELS.WHY)
  const theEdge = extractSection(text, SECTION_LABELS.EDGE)

  // Require the three core sections
  if (!quickAnswer || !whyItMatters || !theEdge) return null

  const mistakeRaw = extractSection(text, SECTION_LABELS.AVOID)
  const confidenceRaw = extractSection(text, SECTION_LABELS.CONFIDENCE)

  let confidence = 0.7 // default when not present
  if (confidenceRaw) {
    const parsed = Number.parseFloat(confidenceRaw)
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) {
      confidence = parsed
    }
  }

  return {
    quickAnswer,
    whyItMatters,
    theEdge,
    mistakeToAvoid: mistakeRaw ?? undefined,
    confidence,
    dataUsed: opts?.dataUsed ?? [],
  }
}

/**
 * Parse a TeachingAnswer from raw LLM text, falling back to the full text
 * as the quickAnswer if the structure is not present.
 *
 * Use this when you want to render a TeachingAnswerCard even when the LLM
 * didn't follow the format (e.g., legacy responses, small-model outputs).
 */
export function parseTeachingAnswerWithFallback(
  text: string,
  opts?: { dataUsed?: string[] }
): TeachingAnswer {
  const parsed = parseTeachingAnswer(text, opts)
  if (parsed) return parsed

  // Graceful degradation: treat entire response as the quick answer
  const trimmed = text.replace(/\s+/g, " ").trim()
  return {
    quickAnswer: trimmed,
    whyItMatters: "",
    theEdge: "",
    confidence: 0.5,
    dataUsed: opts?.dataUsed ?? [],
  }
}

/**
 * Serialize a TeachingAnswer back into the labeled format for display or logging.
 */
export function serializeTeachingAnswer(answer: TeachingAnswer): string {
  const lines: string[] = [
    `QUICK: ${answer.quickAnswer}`,
    `WHY: ${answer.whyItMatters}`,
    `EDGE: ${answer.theEdge}`,
  ]
  if (answer.mistakeToAvoid) {
    lines.push(`AVOID: ${answer.mistakeToAvoid}`)
  }
  lines.push(`CONFIDENCE: ${answer.confidence.toFixed(2)}`)
  return lines.join("\n")
}
