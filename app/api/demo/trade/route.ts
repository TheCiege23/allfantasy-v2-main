import { demoError, demoRateLimit, demoResponse, withDemoContext } from '@/lib/demo-league/http'
import { evaluateDemoTrade } from '@/lib/demo-league/trade'

export const dynamic = 'force-dynamic'

/**
 * POST /api/demo/trade { slotA, slotB, giveA: string[], giveB: string[] }
 * Values a hypothetical trade between two demo teams. Nothing is saved or proposed.
 */
export async function POST(req: Request) {
  const limited = demoRateLimit(req, 'trade', 30, 10 * 60_000)
  if (limited) return limited
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return demoError(400, 'Send JSON.')
  }
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((s) => s.slice(0, 80)) : [])
  const input = { slotA: Number(body.slotA), slotB: Number(body.slotB), giveA: strings(body.giveA), giveB: strings(body.giveB) }
  if (!Number.isInteger(input.slotA) || !Number.isInteger(input.slotB)) return demoError(400, 'Pick two teams.')

  return withDemoContext(async (ctx) => {
    const out = await evaluateDemoTrade(ctx.view, input)
    if (!out.ok) return demoError(out.status, out.error)
    return demoResponse(ctx, out.verdict)
  })
}
