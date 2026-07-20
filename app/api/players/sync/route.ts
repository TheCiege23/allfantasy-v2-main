import { NextRequest, NextResponse } from 'next/server'
import { fetchRIPlayers, fetchRITeams, normalizeRIRouteSport } from '@/lib/players/ri-players-server'
import { SUPPORTED_SPORTS } from '@/lib/sport-scope'
import { revalidateTag } from 'next/cache'
import { requireAdminOrBearer } from '@/lib/adminAuth'
import { buildRateLimit429, consumeRateLimit, getClientIp } from '@/lib/rate-limit'

/** Seconds — Vercel Pro/hobby max; avoids timeout while RI REST returns large lists (15–30s). */
export const maxDuration = 60

const ALLOWED = new Set<string>(SUPPORTED_SPORTS as readonly string[])

export async function POST(req: NextRequest) {
  // Ops-only. Each call costs a 15–30s upstream Rolling Insights fetch and busts the
  // shared `ri-players-*` cache tag for every reader, so an open POST is both an
  // upstream-cost and a cache-invalidation abuse vector.
  const gate = await requireAdminOrBearer(req)
  if (!gate.ok) return gate.res

  const sport = normalizeRIRouteSport(req.nextUrl.searchParams?.get('sport') || 'NFL')
  if (!ALLOWED.has(sport)) {
    return NextResponse.json({ error: 'Invalid sport' }, { status: 400 })
  }

  // Runs after the gate so unauthenticated floods can't exhaust an admin's window.
  // `includeIpInKey` is load-bearing: without it the key collapses to
  // `players:sync:user:anonymous` — one global bucket, not a per-caller limit.
  const rl = consumeRateLimit({
    scope: 'players',
    action: 'sync',
    ip: getClientIp(req),
    includeIpInKey: true,
    maxRequests: 6,
    windowMs: 60_000,
  })
  if (!rl.success) {
    return NextResponse.json(buildRateLimit429({ message: 'Sync cooldown active.', rl }), {
      status: 429,
      headers: { 'Retry-After': String(rl.retryAfterSec) },
    })
  }

  try {
    const [players, teams] = await Promise.all([fetchRIPlayers(sport), fetchRITeams(sport)])
    revalidateTag(`ri-players-${sport.toLowerCase()}`)

    return NextResponse.json({
      sport,
      players: { total: players.length, sample: players[0] ?? null },
      teams: { total: teams.length, sample: teams[0] ?? null },
      imageFieldCheck: {
        playerImg: players[0]?.headshot_url || 'none',
        teamImg: teams[0]?.logo_url || 'none',
      },
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

