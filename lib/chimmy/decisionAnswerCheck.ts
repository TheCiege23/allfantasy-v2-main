/**
 * A SECOND MODEL CHECKS CHIMMY'S DECISION ANSWERS (Decision OS hub, multi-model axis, 2026-11-21 — owner's choice
 * of "second-model check" over bringing the three-brain synthesis back).
 *
 * Chimmy answers with one model (Claude first; another only when Claude fails — `ResponseAggregator.ts`). Nothing
 * independent read the answer before the user did: the deterministic guards check a trade LETTER
 * (`tradeGradeCheck.ts`) and observe numbers (`toolLoopGuardObservation.ts`), but a start/sit call that swapped the two
 * players, a waiver pick named against the panel's #1, or a projection quoted wrong all reached the user.
 *
 * Now, on a DECISION turn only (trade, waiver, start/sit, draft), a small fast model reads the question, the answer and
 * the league facts Chimmy was given, and lists every statement the facts CONTRADICT. A contradiction sends the answer
 * back to Chimmy once with the list; the revised answer is what the user sees.
 *
 * 🛑 IT NEVER MAKES A CALL OF ITS OWN. The checker only compares the answer with the facts; it does not grade, rank or
 * recommend, and the revision is Chimmy's, held to the same facts. A claim the facts merely do not mention is not a
 * contradiction — the facts are the evidence Chimmy read, not everything true.
 *
 * 🛑 FAIL OPEN, ALWAYS. A missing key, AI spend switched off, a timeout, an unreadable verdict or a failed revision
 * each return the answer exactly as Chimmy wrote it. The check can only cost the user time, never an answer.
 *
 * ⚠ BOUNDED: one small call per decision answer (none on chat), DECISION_CHECK_TIMEOUT_MS at most; one revision only
 * when something was contradicted. `CHIMMY_DECISION_CHECK=off` switches it off.
 */

export const DECISION_CHECK_INTENTS: ReadonlySet<string> = new Set(['trade', 'waiver', 'start_sit', 'draft'])
export const DECISION_CHECK_ENV = 'CHIMMY_DECISION_CHECK'
export const DECISION_CHECK_TIMEOUT_MS = 4_000
/** The facts handed to the checker, at most. The head is kept: the packet leads with the slice that answers. */
export const DECISION_CHECK_MAX_FACTS_CHARS = 24_000
/** At most this many contradictions are sent back for the revision. */
export const DECISION_CHECK_MAX_CONTRADICTIONS = 5

export type Contradiction = { claim: string; fact: string }

export type DecisionCheckVerdict = { ok: true } | { ok: false; contradictions: Contradiction[] }

export type DecisionCheckOutcome = 'off' | 'skipped' | 'unavailable' | 'clean' | 'revised' | 'kept'

export type DecisionCheckResult = { outcome: DecisionCheckOutcome; text: string; contradictions: Contradiction[]; ms: number }

/** Is this turn one the second model reads? A decision intent, an answer, and facts to compare it with. */
export function shouldCheckDecisionAnswer(input: {
  intent: string | null | undefined
  answer: string | null | undefined
  facts: string | null | undefined
  env?: string | undefined
}): boolean {
  if (String(input.env ?? '').trim().toLowerCase() === 'off') return false
  if (!input.intent || !DECISION_CHECK_INTENTS.has(input.intent)) return false
  return Boolean(input.answer?.trim()) && Boolean(input.facts?.trim())
}

const CHECK_SYSTEM = [
  "You check a fantasy sports assistant's answer against the league facts it was given. You do not give advice.",
  'List every statement in the ANSWER that the FACTS contradict: a different number, letter grade, player, team, week,',
  'ranking or recommendation than the facts state. A statement the facts do not mention is NOT a contradiction.',
  'Opinions, hedges and general football knowledge are not contradictions.',
  'Reply with JSON only, no prose: {"ok":true} or {"ok":false,"contradictions":[{"claim":"<the answer\'s words>","fact":"<what the facts say>"}]}',
].join(' ')

/** The checker's prompt. The facts are cut to a bound, keeping the head. */
export function buildDecisionCheckPrompt(input: { question: string; answer: string; facts: string }): { system: string; user: string } {
  const facts = input.facts.length > DECISION_CHECK_MAX_FACTS_CHARS ? `${input.facts.slice(0, DECISION_CHECK_MAX_FACTS_CHARS)}\n[…facts cut here]` : input.facts
  return {
    system: CHECK_SYSTEM,
    user: `QUESTION:\n${input.question}\n\nFACTS:\n${facts}\n\nANSWER:\n${input.answer}`,
  }
}

const clip = (s: unknown, n: number) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, n) : '')

/** The checker's reply → a verdict, or null when it is not one (which fails open). */
export function parseDecisionCheckVerdict(raw: string | null | undefined): DecisionCheckVerdict | null {
  if (typeof raw !== 'string') return null
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let v: unknown
  try {
    v = JSON.parse(raw.slice(start, end + 1))
  } catch {
    return null
  }
  if (!v || typeof v !== 'object') return null
  const o = v as { ok?: unknown; contradictions?: unknown }
  if (o.ok === true) return { ok: true }
  if (o.ok !== false || !Array.isArray(o.contradictions)) return null
  const contradictions = o.contradictions
    .map((c) => ({ claim: clip((c as Contradiction)?.claim, 300), fact: clip((c as Contradiction)?.fact, 300) }))
    .filter((c) => c.claim && c.fact)
    .slice(0, DECISION_CHECK_MAX_CONTRADICTIONS)
  // "Not ok" with nothing named is not a finding; it cannot be acted on.
  return contradictions.length ? { ok: false, contradictions } : null
}

/** What Chimmy is told when its answer contradicted its facts. */
export function decisionCorrection(contradictions: readonly Contradiction[]): string {
  return [
    'CORRECTION — a check of your previous answer against the league facts found statements the facts contradict:',
    ...contradictions.map((c, i) => `${i + 1}. You said: "${c.claim}" — the facts say: "${c.fact}".`),
    'Answer the question again, keeping to the facts. Do not mention this correction.',
  ].join('\n')
}

export type DecisionCheckDeps = {
  /** One call to the small model; the reply text, or null on any failure. */
  check: (prompt: { system: string; user: string }, timeoutMs: number) => Promise<string | null>
  /** Ask Chimmy again with the correction; the new answer, or null. */
  revise: (correction: string) => Promise<string | null>
  now: () => number
}

/** Check a decision answer and, on a contradiction, have Chimmy revise it once. Never throws. */
export async function checkDecisionAnswer(
  input: { intent: string | null | undefined; question: string; answer: string; facts: string; env?: string | undefined },
  deps: DecisionCheckDeps,
): Promise<DecisionCheckResult> {
  const started = deps.now()
  const done = (outcome: DecisionCheckOutcome, text: string, contradictions: Contradiction[] = []): DecisionCheckResult => ({
    outcome,
    text,
    contradictions,
    ms: Math.max(0, deps.now() - started),
  })
  if (String(input.env ?? '').trim().toLowerCase() === 'off') return done('off', input.answer)
  if (!shouldCheckDecisionAnswer(input)) return done('skipped', input.answer)

  let verdict: DecisionCheckVerdict | null = null
  try {
    verdict = parseDecisionCheckVerdict(await deps.check(buildDecisionCheckPrompt(input), DECISION_CHECK_TIMEOUT_MS))
  } catch {
    verdict = null
  }
  if (!verdict) return done('unavailable', input.answer)
  if (verdict.ok) return done('clean', input.answer)

  let revised: string | null = null
  try {
    revised = await deps.revise(decisionCorrection(verdict.contradictions))
  } catch {
    revised = null
  }
  return revised?.trim() ? done('revised', revised, verdict.contradictions) : done('kept', input.answer, verdict.contradictions)
}
