import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { buildRateLimit429, consumeRateLimit, getClientIp } from '@/lib/rate-limit'
import { getDashboardLeagueListForUser } from '@/lib/dashboard/get-dashboard-league-list'
import { suggestPlayers } from '@/lib/core-app/playerSuggest'

/**
 * Player Finder typeahead: the finder's own catalog search, ranked and
 * annotated with where each player is in the caller's leagues. Works signed
 * out (no chips, prefix ranking only) so the box on the public /players page
 * keeps suggesting. See lib/core-app/playerSuggest.ts.
 *
 * Rate limited per IP like /api/players/search, a little wider because one
 * search is several requests: the box debounces at 300ms and caches per query.
 */
export const dynamic = 'force-dynamic'

const querySchema = z.object({
  q: z.string().min(2),
  limit: z.coerce.number().int().min(1).max(10).default(8),
})

export async function GET(req: Request) {
  const rl = consumeRateLimit({
    scope: 'players',
    action: 'suggest',
    ip: getClientIp(req),
    includeIpInKey: true,
    maxRequests: 40,
    windowMs: 60_000,
  })
  if (!rl.success) {
    return NextResponse.json(buildRateLimit429({ message: 'Search cooldown active. Please slow down.', rl }), {
      status: 429,
      headers: { 'Retry-After': String(rl.retryAfterSec) },
    })
  }

  const { searchParams } = new URL(req.url)
  const parsed = querySchema.safeParse(Object.fromEntries(searchParams))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid query' }, { status: 400 })

  const session = (await getServerSession(authOptions as never).catch(() => null)) as { user?: { id?: string } } | null
  const userId = typeof session?.user?.id === 'string' && session.user.id.trim() ? session.user.id.trim() : null

  const suggestions = await suggestPlayers({
    query: parsed.data.q,
    userId,
    limit: parsed.data.limit,
    loadLeagueIds: async () => {
      if (!userId) return []
      const payload = await getDashboardLeagueListForUser(userId)
      // The same filter the /core page applies: rows with no unified record are not played leagues.
      return (payload.leagues as Array<{ id?: unknown; hasUnifiedRecord?: unknown }>)
        .filter((l) => l.hasUnifiedRecord !== false && typeof l.id === 'string')
        .map((l) => l.id as string)
    },
  })
  return NextResponse.json(suggestions, { headers: { 'Cache-Control': 'private, no-store' } })
}
