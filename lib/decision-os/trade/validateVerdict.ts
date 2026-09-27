import {
  allowedNumbers,
  numbersInText,
  resolvePacketPath,
  type ExplanationPacket,
} from './explanationPacket'
import { HEADLINE_MAX_CHARS, MAX_REASONS, MIN_REASONS, TradeVerdictSchema, type TradeVerdict } from './tradeVerdict'

/**
 * EVERY CHECK THE DESIGN NAMES, BEFORE AN EXPLANATION IS SHOWN (design, "AI explanation layer" and
 * "AI output checks"). PURE. A violation list, never a boolean — the list is fed back to the model on
 * the one retry, and logged when the template takes over.
 *
 *   - schema valid (strict: an extra key fails)
 *   - grades, verdict and confidence equal the packet's `fixed` values exactly
 *   - 2 to 4 reasons (1 to 4 when the grade is withheld), each citing a packet path that exists
 *   - lineup impact leads, when the packet has any
 *   - at least one risk
 *   - a counter only at a gap of 10% or more, naming only assets in the packet
 *   - every number in the text is a packet number
 *   - no odds, locks, guarantees or betting terms
 *   - headline 280 characters or fewer
 *
 * ⚠ THE NUMBER CHECK COMPARES AT THE PRECISION THE TEXT WRITES. "12.3" matches 12.34 and "12" matches
 * 12.4, because a rounded packet number is the same fact. "13" does not match 12.4: that is a number
 * the packet does not contain, which is the thing this check exists to catch.
 */

export type VerdictValidation = { ok: true; verdict: TradeVerdict } | { ok: false; violations: string[] }

/**
 * Rule 6. Word-bounded so "blocked", "bettor" in a name or "flock" do not trip it; each entry is a
 * term that only ever reads as gambling or certainty in a trade explanation.
 */
const BANNED_LANGUAGE: Array<{ re: RegExp; term: string }> = [
  { re: /\bodds\b/i, term: 'odds' },
  { re: /\blocks?\b/i, term: 'lock' },
  { re: /\bguarantee[ds]?\b/i, term: 'guarantee' },
  { re: /\bbet(?:s|ting)?\b/i, term: 'bet' },
  { re: /\bwagers?\b/i, term: 'wager' },
  { re: /\bparlays?\b/i, term: 'parlay' },
  { re: /\bmoneyline\b/i, term: 'moneyline' },
  { re: /\bsure thing\b/i, term: 'sure thing' },
  { re: /\bcan(?:'|’)?t lose\b/i, term: "can't lose" },
  { re: /\bfree money\b/i, term: 'free money' },
  { re: /\brisk[- ]free\b/i, term: 'risk-free' },
  { re: /\bslam dunk\b/i, term: 'slam dunk' },
]

/** A letter grade stated in prose: "grade of B", "a C grade", "graded an A". */
const LETTER_IN_TEXT = [
  /\bgrade[sd]?\s+(?:of\s+|is\s+|was\s+)?(?:an?\s+)?([A-F])\b(?![-/])/g,
  /\b(?:an?\s+)([A-F])\s+grade\b/g,
]

const LINEUP_PATH = /^(?:lineup\.teamA|seasonOutlook\.teamA)\b/

function textsOf(v: TradeVerdict): Array<{ where: string; text: string }> {
  return [
    { where: 'headline', text: v.headline },
    ...v.reasons.map((r, i) => ({ where: `reasons[${i}]`, text: r.text })),
    ...v.risks.map((r, i) => ({ where: `risks[${i}]`, text: r })),
    ...(v.counter ? [{ where: 'counter.why', text: v.counter.why }] : []),
  ]
}

function roundTo(value: number, decimals: number): number {
  const f = 10 ** decimals
  return Math.round(value * f) / f
}

export function validateVerdict(raw: unknown, packet: ExplanationPacket): VerdictValidation {
  const parsed = TradeVerdictSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      violations: parsed.error.issues.map((i) => `schema: ${i.path.join('.') || '(root)'} ${i.message}`),
    }
  }
  const v = parsed.data
  const violations: string[] = []
  const fixed = packet.fixed

  // Copied fields.
  const expectedGrades = fixed.grades
    ? [`teamA:${fixed.grades.teamA}`, `teamB:${fixed.grades.teamB}`].sort()
    : []
  const gotGrades = v.grades.map((g) => `${g.teamId}:${g.grade}`).sort()
  if (JSON.stringify(expectedGrades) !== JSON.stringify(gotGrades)) {
    violations.push(`grades must be exactly ${JSON.stringify(expectedGrades)}; got ${JSON.stringify(gotGrades)}`)
  }
  if (v.verdict !== fixed.verdict) violations.push(`verdict must be ${JSON.stringify(fixed.verdict)}; got ${JSON.stringify(v.verdict)}`)
  if (v.confidence !== fixed.confidence) violations.push(`confidence must be "${fixed.confidence}"; got "${v.confidence}"`)

  // Reasons and their evidence.
  const minReasons = packet.graded ? MIN_REASONS : 1
  if (v.reasons.length < minReasons || v.reasons.length > MAX_REASONS) {
    violations.push(`reasons: need ${minReasons} to ${MAX_REASONS}; got ${v.reasons.length}`)
  }
  v.reasons.forEach((r, i) => {
    if (r.evidence.length === 0) violations.push(`reasons[${i}]: cites no evidence`)
    for (const path of r.evidence) {
      if (resolvePacketPath(packet, path) === undefined) violations.push(`reasons[${i}]: evidence path "${path}" is not in the packet`)
    }
  })
  const hasLineup =
    packet.lineup.teamA?.startingPointsDelta != null || packet.seasonOutlook != null
  if (hasLineup && v.reasons.length > 0 && !v.reasons[0]!.evidence.some((p) => LINEUP_PATH.test(p.trim()))) {
    violations.push('reasons[0]: must lead with Team A\'s lineup impact (cite lineup.teamA or seasonOutlook.teamA)')
  }

  // Risks.
  if (v.risks.length === 0) violations.push('risks: name at least one')

  // Counter.
  if (v.counter) {
    if (!packet.counter.allowed) {
      violations.push('counter: not allowed — the gap is under 10% or the trade is not graded')
    }
    const known = new Set(packet.counter.assetNames.map((n) => n.trim().toLowerCase()))
    const names = [...v.counter.add, ...v.counter.remove]
    if (names.length === 0) violations.push('counter: names no asset to add or remove')
    for (const n of names) {
      if (!known.has(n.trim().toLowerCase())) violations.push(`counter: "${n}" is not an asset on either roster`)
    }
  }

  // Every number, every letter, every word.
  const allowed = allowedNumbers(packet)
  const letters = new Set(fixed.grades ? [fixed.grades.teamA, fixed.grades.teamB] : [])
  for (const { where, text } of textsOf(v)) {
    for (const n of numbersInText(text)) {
      if (!allowed.some((a) => Math.abs(roundTo(a, n.decimals) - n.value) < 1e-9)) {
        violations.push(`${where}: the number ${n.raw} is not in the packet`)
      }
    }
    for (const re of LETTER_IN_TEXT) {
      for (const m of text.matchAll(re)) {
        if (!letters.has(m[1] as never)) violations.push(`${where}: states a grade of ${m[1]}, which the engine did not give`)
      }
    }
    for (const { re, term } of BANNED_LANGUAGE) {
      if (re.test(text)) violations.push(`${where}: uses betting/certainty language ("${term}")`)
    }
  }
  if (v.headline.length > HEADLINE_MAX_CHARS) {
    violations.push(`headline: ${v.headline.length} characters; the limit is ${HEADLINE_MAX_CHARS}`)
  }

  return violations.length === 0 ? { ok: true, verdict: v } : { ok: false, violations }
}
