import { NextRequest, NextResponse } from 'next/server'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { loadSurvivorWatchData } from '@/lib/survivor/spectator/watchPage'

export const dynamic = 'force-dynamic'

/**
 * The public watch page's data (spectator mode), for its live refresh. No sign-in: it returns only
 * what the page itself shows, and only when the commissioner opened the watch page. An unknown or
 * non-Survivor league is a 404, the same as the page.
 */
export async function GET(req: NextRequest) {
  const limit = rateLimit(`survivor-watch:${getClientIp(req)}`, 120, 60_000)
  if (!limit.success) return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': '60' } })
  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
  const data = await loadSurvivorWatchData(leagueId)
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } })
}
