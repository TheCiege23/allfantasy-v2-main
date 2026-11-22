import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const SLEEPER_TRENDING_SPORTS = new Set(['nfl', 'nba', 'nhl', 'mlb', 'lcs'])

/** Proxies Sleeper public trending endpoint (no auth). */
export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams?.get('type')?.trim() || 'add'
  const sport = req.nextUrl.searchParams?.get('sport')?.trim().toLowerCase() || 'nfl'
  if (type !== 'add' && type !== 'drop') {
    return NextResponse.json({ error: 'type must be add or drop' }, { status: 400 })
  }
  // `sport` is a path segment in the upstream URL — an allowlist, so `../` cannot walk it
  // onto another Sleeper path.
  if (!SLEEPER_TRENDING_SPORTS.has(sport)) {
    return NextResponse.json({ error: 'unsupported sport' }, { status: 400 })
  }

  const url = `https://api.sleeper.app/v1/players/${sport}/trending/${type}?lookback_hours=24&limit=25` // db-first-exception: pass-through trending endpoint requires near-real-time public feed
  try {
    const res = await fetch(url, { next: { revalidate: 120 } })
    if (!res.ok) {
      return NextResponse.json({ error: 'Trending unavailable' }, { status: 502 })
    }
    const data: unknown = await res.json()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: 'Trending fetch failed' }, { status: 502 })
  }
}

