import { NextRequest, NextResponse } from 'next/server'
import { requireVerifiedUser } from '@/lib/auth-guard'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import {
  getFantraxLeagueInfo,
  getFantraxPlayerIds,
  parseFantraxLeagueId,
  type FantraxSport,
} from '@/lib/league-import/fantrax/fantraxApi'

const SPORTS = new Set<FantraxSport>(['CFB', 'NCAAF', 'NFL', 'MLB', 'NBA', 'NHL'])

/** Read-only, league-specific waiver wire and free-agent listing. */
export async function GET(req: NextRequest) {
  const auth = await requireVerifiedUser()
  if (!auth.ok) return auth.response

  const ip = getClientIp(req) || 'unknown'
  if (!rateLimit(`fantrax-player-pool:${auth.userId}:${ip}`, 10, 60_000).success) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const params = req.nextUrl.searchParams
  const leagueId = parseFantraxLeagueId(params.get('leagueId') ?? '')
  const sport = (params.get('sport') ?? '').trim().toUpperCase() as FantraxSport
  const status = (params.get('status') ?? 'ALL').trim().toUpperCase()
  const page = Number(params.get('page') ?? 1)
  const limit = Number(params.get('limit') ?? 50)
  const search = (params.get('search') ?? '').trim()
  if (!leagueId || !SPORTS.has(sport) || !['ALL', 'WW', 'FA'].includes(status) ||
      !Number.isInteger(page) || page < 1 || page > 1000 ||
      !Number.isInteger(limit) || limit < 1 || limit > 100 || search.length > 100) {
    return NextResponse.json({ error: 'Invalid player-pool filters.' }, { status: 400 })
  }

  const info = await getFantraxLeagueInfo(leagueId)
  if (!info.ok) {
    return NextResponse.json({ error: info.failure.message }, {
      status: info.failure.kind === 'not_found' ? 404 : 503,
    })
  }
  const names = await getFantraxPlayerIds(sport)
  if (!names.ok) {
    return NextResponse.json({ error: names.failure.message }, { status: 503 })
  }

  const pool = Object.entries(info.data.playerInfo ?? {})
    .map(([id, value]) => ({ id, detail: value as { status?: unknown; eligiblePos?: unknown } }))
  if (pool.length > 0 && !pool.some(({ id }) => names.data[id])) {
    return NextResponse.json({ error: 'The sport does not match this Fantrax league.' }, { status: 422 })
  }
  const waiverWire = pool.filter(({ detail }) => detail?.status === 'WW').length
  const freeAgents = pool.filter(({ detail }) => detail?.status === 'FA').length
  const query = search.toLowerCase()
  const filtered = pool
    .filter(({ id, detail }) => (status === 'ALL' || detail?.status === status) &&
      (detail?.status === 'WW' || detail?.status === 'FA') && names.data[id])
    .map(({ id, detail }) => ({
      id,
      name: names.data[id]!.name,
      team: names.data[id]!.team,
      position: names.data[id]!.position || String(detail.eligiblePos ?? ''),
      status: detail.status as 'WW' | 'FA',
    }))
    .filter((player) => !query ||
      player.name.toLowerCase().includes(query) ||
      player.team.toLowerCase().includes(query) ||
      player.position.toLowerCase().includes(query))
  const start = (page - 1) * limit

  return NextResponse.json({
    leagueId,
    leagueName: info.data.leagueName,
    sport,
    counts: { waiverWire, freeAgents },
    page,
    limit,
    total: filtered.length,
    players: filtered.slice(start, start + limit),
  }, { headers: { 'Cache-Control': 'private, no-store' } })
}
