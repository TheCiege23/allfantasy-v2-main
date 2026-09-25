import { recordChimmyContextRun } from './recordRun'

/**
 * One row per question asked of Chimmy's main chat route (owner's call 2026-09-24: "record each
 * question — which screen it came from, which tool Chimmy used, whether it answered").
 *
 * Measured the same day: `chimmy_context_runs` was EMPTY. Its writer was wired only to the older
 * `/api/ai/chat` route, never to `/api/chat/chimmy`, which every Chimmy surface now uses — so there
 * was no record of what anyone asked, where from, or where Chimmy failed them.
 *
 * Stored in that same table (no migration) as surface `chimmy_chat`:
 *   intent            where it was asked — `drawer:<screen>` from the /core drawer, else the caller's
 *                     `source` (`messages_ai` is the /chimmy/chat page)
 *   provider_meta     the tools the answer used, in order
 *   error_message     NULL when answered; otherwise the outcome below
 *   league_id, duration_ms
 *
 * NO QUESTION TEXT, EVER — the table's own contract is "no PII (emails, raw content)".
 *
 * ⚠ `price_shown` IS NOT A QUESTION. The drawer's first send of a paid question comes back 409
 * "confirm the price"; the confirmed resend is the question. It is recorded (it measures how often
 * people see the price and walk away) but a question count must exclude it.
 */

export type ChimmyQuestionTelemetry = {
  userId: string | null
  leagueId: string | null
  entry: string | null
  tools: string[]
}

export function newQuestionTelemetry(): ChimmyQuestionTelemetry {
  return { userId: null, leagueId: null, entry: null, tools: [] }
}

export { questionEntry } from './questionEntry'

export type ChimmyQuestionOutcome =
  | 'answered'
  | 'price_shown'
  | 'out_of_answers'
  | 'upgrade_required'
  | 'needs_league'
  | 'rate_limited'
  | 'bad_request'
  | 'forbidden'
  | 'error'
  | `http_${number}`

type ResponseBody = {
  code?: unknown
  upgradeRequired?: unknown
  preview?: { canSpend?: unknown } | null
} | null

export function questionOutcome(status: number, body: ResponseBody): ChimmyQuestionOutcome {
  if (status >= 200 && status < 300) return body?.upgradeRequired === true ? 'upgrade_required' : 'answered'
  if (status === 402) return 'out_of_answers'
  if (status === 409) {
    // The preflight says whether the user can pay at all; only "cannot" is a refusal.
    return body?.preview && body.preview.canSpend === false ? 'out_of_answers' : 'price_shown'
  }
  if (status === 412) return 'needs_league'
  if (status === 429) return 'rate_limited'
  if (status === 400) return 'bad_request'
  if (status === 403) return 'forbidden'
  if (status >= 500) return 'error'
  return `http_${status}`
}

/** Reads the outcome off the response the user got, and writes the row. Never throws. */
export async function recordChimmyQuestion(
  question: ChimmyQuestionTelemetry,
  res: { status: number; headers?: { get(name: string): string | null }; clone?: () => { json(): Promise<unknown> } },
  durationMs: number,
): Promise<void> {
  try {
    // No user, no row: an unauthenticated or rate-limited-before-auth request is not a question.
    if (!question.userId) return
    let body: ResponseBody = null
    const isJson = (res.headers?.get('content-type') ?? '').includes('application/json')
    if (isJson && res.clone && (res.status === 200 || res.status === 402 || res.status === 409)) {
      body = ((await res.clone().json().catch(() => null)) ?? null) as ResponseBody
    }
    const outcome = questionOutcome(res.status, body)
    await recordChimmyContextRun({
      userId: question.userId,
      surface: 'chimmy_chat',
      leagueId: question.leagueId,
      intent: question.entry ?? 'unknown',
      durationMs,
      providers: question.tools.map((name) => ({ name, ok: true, cached: false, durationMs: 0 })),
      errorMessage: outcome === 'answered' ? null : outcome,
    })
  } catch {
    /* a lost row, never a lost answer */
  }
}
