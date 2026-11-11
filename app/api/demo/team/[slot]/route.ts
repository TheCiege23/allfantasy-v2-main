import { demoError, demoRateLimit, demoReadOnlyResponse, demoResponse, withDemoContext } from '@/lib/demo-league/http'

export const dynamic = 'force-dynamic'

/** GET /api/demo/team/:slot — one demo team: identity, standing and roster. */
export async function GET(req: Request, props: { params: Promise<{ slot: string }> }) {
  const limited = demoRateLimit(req, 'read', 120, 60_000)
  if (limited) return limited
  const { slot: raw } = await props.params
  const slot = Number(raw)
  if (!Number.isInteger(slot) || slot < 1 || slot > 64) return demoError(400, 'Unknown team')
  return withDemoContext((ctx) => {
    const team = ctx.view.teams.find((t) => t.slot === slot)
    if (!team) return demoError(404, 'Unknown team')
    return demoResponse(ctx, {
      demo: true,
      team,
      standing: ctx.view.standings.find((s) => s.slot === slot) ?? null,
      roster: ctx.view.rosters.find((r) => r.slot === slot) ?? null,
      trades: ctx.view.trades.filter((t) => t.sides.some((s) => s.slot === slot)),
    })
  })
}

export const POST = demoReadOnlyResponse
export const PUT = demoReadOnlyResponse
export const PATCH = demoReadOnlyResponse
export const DELETE = demoReadOnlyResponse
