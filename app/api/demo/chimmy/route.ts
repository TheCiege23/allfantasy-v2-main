import { demoError, demoRateLimit, demoResponse, withDemoContext } from '@/lib/demo-league/http'
import { askDemoChimmy, takeDemoChimmyBudget } from '@/lib/demo-league/chimmy'

export const dynamic = 'force-dynamic'

/**
 * POST /api/demo/chimmy { message } — Chimmy, grounded on the anonymized demo league only.
 * No account needed; per-IP and daily caps bound the spend. The answer goes through the
 * same redactor wall as every other demo response.
 */
export async function POST(req: Request) {
  const limited = demoRateLimit(req, 'chimmy', 8, 10 * 60_000)
  if (limited) return limited
  let message = ''
  try {
    const body = (await req.json()) as { message?: unknown }
    message = typeof body.message === 'string' ? body.message : ''
  } catch {
    return demoError(400, 'Send JSON: { "message": "..." }')
  }
  if (!message.trim()) return demoError(400, 'Ask Chimmy something about the demo league.')

  return withDemoContext(async (ctx) => {
    if (!takeDemoChimmyBudget()) return demoError(429, 'Demo Chimmy has answered its fill for today — sign up to keep asking.')
    /*
     * 🛑 NEUTRAL, NOT ALIAS. A visitor who types a real manager's name must not get it back
     * rewritten as that manager's fake name — that would confirm who the alias is. Real names
     * are neutralised in the question before the model sees it and in the answer before the
     * visitor does; the alias redactor in demoResponse is then the final wall.
     */
    const out = await askDemoChimmy(ctx.view, ctx.neutralRedactor.scrubString(message))
    if (!out.ok) return demoError(out.reason === 'empty' ? 400 : 503, 'Chimmy is unavailable right now. Try again shortly.')
    return demoResponse(ctx, { demo: true, answer: ctx.neutralRedactor.scrubString(out.answer) })
  })
}
