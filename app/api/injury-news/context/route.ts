import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { resolvePlayerInjuryNewsBatch } from '@/lib/news-injury-aggregation/resolveBatch'
import { buildRateLimit429, consumeRateLimit, getClientIp } from '@/lib/rate-limit'
import { ingestXNewsForPlayers } from '@/lib/workers/x-news-ingestion'

/**
 * How many players one refresh may search.
 *
 * Deliberately far below the GET handler's 24-name read cap, because reading is
 * free and searching is not: one subject costs 8-15 billed server-side x_search
 * calls, so even 5 is up to ~75 searches for a single press of a button.
 */
const X_REFRESH_MAX_PLAYERS = 5

/** Per user+IP. A refresh is a deliberate act, not something to hold down. */
const REFRESH_LIMIT = 4
const REFRESH_WINDOW_MS = 10 * 60 * 1000

/**
 * GET /api/injury-news/context?sport=NFL&players=Name1,Name2
 * Shared injury + news aggregation for debugging and lightweight clients.
 */
export async function GET(req: Request) {
  const session = (await getServerSession(authOptions as never)) as {
    user?: { id?: string }
  } | null
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const sport = normalizeToSupportedSport(searchParams.get('sport') ?? 'NFL')
  const raw = searchParams.get('players') ?? ''
  const names = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 24)

  if (names.length === 0) {
    return NextResponse.json({ ok: false, error: 'Missing players query (comma-separated names)' }, { status: 400 })
  }

  const skipNews = searchParams.get('skipNewsContext') === '1'
  const map = await resolvePlayerInjuryNewsBatch({
    prisma,
    sport,
    players: names.map((playerName) => ({ playerName })),
    skipNewsContext: skipNews,
  })

  const players = names.map((n) => {
    const layer = map.get(n.toLowerCase()) ?? null
    return { playerName: n, layer }
  })

  return NextResponse.json({
    ok: true,
    sport,
    fetchedAt: new Date().toISOString(),
    players,
  })
}

/**
 * POST /api/injury-news/context
 * Body: { sport?: string, players: string[] }
 *
 * Search X for fresh news on a small, explicit set of players, write it to
 * PlayerNewsRecord, then return the same shape GET returns — now including
 * whatever was just found.
 *
 * POST rather than a flag on GET, deliberately: this one spends money. A GET
 * that bills is reachable by a link prefetch, a crawler, or a browser's
 * speculative fetch, and none of those is a person asking for fresh news. Same
 * path as GET, so it costs nothing against the route budget.
 *
 * Writing to PlayerNewsRecord is what makes this worth doing at all: Decision OS
 * reads that table (lib/decision-os/world/port.ts), so a refresh here also
 * improves lineup signals rather than only this response.
 */
export async function POST(req: Request) {
  const session = (await getServerSession(authOptions as never)) as {
    user?: { id?: string }
  } | null
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const rl = consumeRateLimit({
    scope: 'injury_news',
    action: 'x_refresh',
    sleeperUsername: session.user.id,
    ip: getClientIp(req),
    maxRequests: REFRESH_LIMIT,
    windowMs: REFRESH_WINDOW_MS,
    // Without this the bucket key collapses to one global bucket for every user.
    includeIpInKey: true,
  })
  if (!rl.success) {
    return NextResponse.json(
      buildRateLimit429({ message: 'Too many news refreshes. Try again shortly.', rl }),
      { status: 429 },
    )
  }

  let body: { sport?: unknown; players?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const sport = normalizeToSupportedSport(typeof body.sport === 'string' ? body.sport : 'NFL')
  const requested = Array.isArray(body.players)
    ? body.players.filter((p): p is string => typeof p === 'string' && p.trim() !== '').map((p) => p.trim())
    : []

  if (requested.length === 0) {
    return NextResponse.json({ ok: false, error: 'Missing players (array of names)' }, { status: 400 })
  }

  const names = requested.slice(0, X_REFRESH_MAX_PLAYERS)

  // Never throws: a disabled spend switch, a provider error and a genuine
  // "no news" all come back in the result. A failed refresh must still return
  // the stored view rather than 500 — stale news beats no news.
  const refresh = await ingestXNewsForPlayers({
    sport,
    players: names.map((name) => ({ name })),
    kind: 'injury',
    maxPlayers: X_REFRESH_MAX_PLAYERS,
  })

  // DB + cache only. The live refresh already happened above, against X; letting
  // this default to false would fire a SECOND live fetch at a different provider
  // on a request that has already spent. Callers wanting that path still have GET.
  const map = await resolvePlayerInjuryNewsBatch({
    prisma,
    sport,
    players: names.map((playerName) => ({ playerName })),
    skipNewsContext: true,
  })

  const players = names.map((n) => ({ playerName: n, layer: map.get(n.toLowerCase()) ?? null }))

  return NextResponse.json({
    ok: true,
    sport,
    fetchedAt: new Date().toISOString(),
    refresh: {
      searched: refresh.searched,
      // Names dropped for exceeding the cap, so a caller that asked for more
      // can tell the difference between "no news" and "never looked".
      notSearched: requested.slice(X_REFRESH_MAX_PLAYERS),
      newRecords: refresh.newRecords,
      duplicatesSkipped: refresh.duplicatesSkipped,
      noNews: refresh.noNews,
      errors: refresh.errors,
    },
    players,
  })
}
