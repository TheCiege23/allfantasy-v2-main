import { demoRateLimit, demoReadOnlyResponse, demoResponse, withDemoContext } from '@/lib/demo-league/http'
import { searchPlayers } from '@/lib/core-app/playerFinder'

export const dynamic = 'force-dynamic'

/**
 * GET /api/demo/players?q= — Player Finder for the demo: public player search, annotated
 * with which DEMO team (fake name) rosters each player. Only allowlisted fields are returned.
 */
export async function GET(req: Request) {
  const limited = demoRateLimit(req, 'players', 60, 60_000)
  if (limited) return limited
  const q = (new URL(req.url).searchParams.get('q') ?? '').trim().slice(0, 60)

  return withDemoContext(async (ctx) => {
    const owner = new Map<string, number>()
    for (const r of ctx.view.rosters) for (const p of [...r.starters, ...r.bench]) owner.set(p.name.toLowerCase(), r.slot)
    const team = (slot: number | undefined) => (slot == null ? null : ctx.view.teams.find((t) => t.slot === slot) ?? null)

    if (q.length < 2) {
      // No query: list the demo league's own rostered players, which is what a visitor wants first.
      const all = ctx.view.rosters.flatMap((r) => [...r.starters, ...r.bench].map((p) => ({ ...p, slot: r.slot })))
      return demoResponse(ctx, {
        demo: true,
        results: all.slice(0, 40).map((p) => ({ name: p.name, position: p.position, team: p.team, imageUrl: p.headshotUrl, demoTeam: team(p.slot) })),
      })
    }

    const matches = await searchPlayers(q, 15, ctx.view.settings.sport).catch(() => [])
    return demoResponse(ctx, {
      demo: true,
      results: matches.map((m) => ({
        name: m.name,
        position: m.position,
        team: m.team,
        imageUrl: m.imageUrl,
        demoTeam: team(owner.get(m.name.toLowerCase())),
      })),
    })
  })
}

export const POST = demoReadOnlyResponse
export const PUT = demoReadOnlyResponse
export const PATCH = demoReadOnlyResponse
export const DELETE = demoReadOnlyResponse
