import { checkChimmyHallucination, type ChimmyHallucinationAction, type ChimmyHallucinationIssueKind } from '@/lib/chimmy-chat/hallucination-guard'

/**
 * The hallucination guard, run in OBSERVE-ONLY mode on the tool loop's answer.
 *
 * 🛑 THE GUARD NEVER SAW THE PATH THAT ANSWERS MOST MESSAGES. `route.ts` returns at the tool loop
 * (`source: 'chimmy_tool_loop'`); `checkChimmyHallucination` ran only on the PECR fallback. So the
 * HailShiva answer "Your card's 51.9% does not match this" (production 2026-10-06) was never checked.
 * And where the guard did run, its grounding included the stored chat history, so a number from an
 * earlier message counted as "verified" anyway.
 *
 * Here the grounding is what this answer could legitimately have used: the tool results the loop
 * actually read, the server's own prompt lines, and the CURRENT question. Never earlier turns.
 *
 * ⚠ OBSERVE, DO NOT ENFORCE — YET. The guard matches number TOKENS exactly, and the loop's tools
 * return raw values ("65.12") that answers round ("65%"). Enforced as-is it would replace honest
 * answers, which is a worse failure than the one it guards. `roundedMatches` measures exactly that,
 * so the decision to enforce is made on production data, not on a guess.
 */
export type ToolLoopGuardObservation = {
  /** What the guard WOULD have done. Nothing is done: the answer is returned unchanged. */
  wouldAction: ChimmyHallucinationAction
  hardIssues: number
  softIssues: number
  kinds: ChimmyHallucinationIssueKind[]
  /** Flagged numbers that are only a rounding of a number the tools did return. */
  roundedMatches: number
  /** Flagged numbers with no tool value anywhere near them — the ones that matter. */
  unmatched: string[]
  evidenceChars: number
}

const NUMBER = /-?\d+(?:\.\d+)?/g

function numbersIn(text: string): number[] {
  return (text.match(NUMBER) ?? []).map(Number).filter(Number.isFinite)
}

/** "65%" against 65.12, "76.4" against 76.39: the token, at its own precision, is a rounding of a grounded value. */
function isRoundingOf(token: string, grounded: readonly number[]): boolean {
  const value = Number(token.replace('%', ''))
  if (!Number.isFinite(value)) return false
  const decimals = token.replace('%', '').split('.')[1]?.length ?? 0
  const half = 0.5 / 10 ** decimals + 1e-9
  return grounded.some((g) => Math.abs(g - value) <= half)
}

export function observeToolLoopAnswer(args: {
  answer: string
  /** Tool results the loop read, in order. */
  evidence: string
  /** Server-built prompt lines the model saw (league grounding, clock, track record). Not the static instructions. */
  promptLines: ReadonlyArray<string | null | undefined>
  question: string
  hasLeagueContext: boolean
}): ToolLoopGuardObservation {
  const groundingText = [args.evidence, ...args.promptLines, args.question].filter((s): s is string => Boolean(s?.trim())).join('\n\n')
  const check = checkChimmyHallucination(args.answer, { groundingText, hasLeagueContext: args.hasLeagueContext, userMessage: args.question })
  const grounded = numbersIn(groundingText)
  const flagged = check.issues
    .filter((i) => i.kind === 'ungrounded_stat')
    .map((i) => /"([^"]+)"/.exec(i.detail)?.[1])
    .filter((t): t is string => Boolean(t))
  const unmatched = flagged.filter((t) => !isRoundingOf(t, grounded))
  return {
    wouldAction: check.action,
    hardIssues: check.issues.filter((i) => i.severity === 'hard').length,
    softIssues: check.issues.filter((i) => i.severity === 'soft').length,
    kinds: [...new Set(check.issues.map((i) => i.kind))],
    roundedMatches: flagged.length - unmatched.length,
    unmatched: unmatched.slice(0, 8),
    evidenceChars: args.evidence.length,
  }
}
