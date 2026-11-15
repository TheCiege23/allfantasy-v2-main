import { demoError, demoRateLimit, demoResponse, withDemoContext } from '@/lib/demo-league/http'
import { askDemoChimmy, takeDemoChimmyBudget, type DemoChimmyTurn } from '@/lib/demo-league/chimmy'

export const dynamic = 'force-dynamic'

/** Shown only after the server's own retries (and the client's one silent retry) have failed. */
const UNAVAILABLE_MESSAGE = "Chimmy couldn't get an answer through just now — the AI service is busy. Give it another try."

/**
 * POST /api/demo/chimmy { message, history?, continueFrom? } — Chimmy, grounded on the anonymized
 * demo league only. No account needed; per-IP and daily caps bound the spend. The answer goes
 * through the same redactor wall as every other demo response.
 *
 * `history` (the visitor's last few exchanges, so "why?" means something) and `continueFrom` (a
 * cut-off answer to finish) both come from the browser, so they are scrubbed exactly like the
 * question before the model sees them.
 */
export async function POST(req: Request) {
  const limited = demoRateLimit(req, 'chimmy', 8, 10 * 60_000)
  if (limited) return limited
  let message = ''
  let history: DemoChimmyTurn[] = []
  let continueFrom: string | null = null
  try {
    const body = (await req.json()) as { message?: unknown; history?: unknown; continueFrom?: unknown }
    message = typeof body.message === 'string' ? body.message : ''
    if (Array.isArray(body.history)) {
      history = body.history
        .filter((t): t is { q: string; a: string } =>
          Boolean(t) && typeof (t as { q?: unknown }).q === 'string' && typeof (t as { a?: unknown }).a === 'string')
        .slice(-3)
        .map((t) => ({ q: t.q.slice(0, 500), a: t.a.slice(0, 1200) }))
    }
    if (typeof body.continueFrom === 'string' && body.continueFrom.trim()) continueFrom = body.continueFrom.slice(0, 2400)
  } catch {
    return demoError(400, 'Send JSON: { "message": "..." }')
  }
  if (!message.trim()) return demoError(400, 'Ask Chimmy something about the demo league.')

  return withDemoContext(async (ctx) => {
    if (!takeDemoChimmyBudget()) return demoError(429, 'Demo Chimmy has answered its fill for today — sign up to keep asking.', { code: 'daily_cap' })
    /*
     * 🛑 NEUTRAL, NOT ALIAS. A visitor who types a real manager's name must not get it back
     * rewritten as that manager's fake name — that would confirm who the alias is. Real names
     * are neutralised in the question before the model sees it and in the answer before the
     * visitor does; the alias redactor in demoResponse is then the final wall. The same goes for
     * the history and the cut-off answer, which the browser sends back to us.
     */
    const scrub = (s: string) => ctx.neutralRedactor.scrubString(s)
    const out = await askDemoChimmy(ctx.view, scrub(message), {
      history: history.map((t) => ({ q: scrub(t.q), a: scrub(t.a) })),
      continueFrom: continueFrom ? scrub(continueFrom) : null,
    })
    if (!out.ok) {
      if (out.reason === 'empty') return demoError(400, 'Ask Chimmy something about the demo league.')
      return demoError(503, UNAVAILABLE_MESSAGE, { code: 'chimmy_unavailable', retryable: out.retryable })
    }
    return demoResponse(ctx, { demo: true, answer: scrub(out.answer), truncated: out.truncated })
  })
}
