import { NextRequest, NextResponse } from 'next/server'
import { fetchFantasyCalcValues } from '@/lib/player-valuations/canonicalPlayerValuations'

let cachedPlayers: any[] | null = null
let cacheTime = 0
const CACHE_TTL = 5 * 60 * 1000

const requestCounts = new Map<string, { count: number; resetAt: number }>()

function checkRate(ip: string): boolean {
  const now = Date.now()
  const entry = requestCounts.get(ip)
  if (!entry || now > entry.resetAt) {
    requestCounts.set(ip, { count: 1, resetAt: now + 60000 })
    return true
  }
  entry.count++
  return entry.count <= 60
}

export async function GET(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!checkRate(ip)) {
    return NextResponse.json({ error: 'Rate limited' }, { status: 429 })
  }

  const q = req.nextUrl.searchParams?.get('q')?.toLowerCase().trim()
  if (!q || q.length < 2) return NextResponse.json([])

  try {
    const now = Date.now()
    if (!cachedPlayers || now - cacheTime > CACHE_TTL) {
      const fresh = await fetchFantasyCalcValues({ isDynasty: true, numQbs: 1, numTeams: 12, ppr: 1 })
      if (fresh && fresh.length > 0) {
        cachedPlayers = fresh
        cacheTime = now
      }
    }

    if (!cachedPlayers || cachedPlayers.length === 0) {
      return NextResponse.json([])
    }

    const normalize = (s: string) =>
      s.toLowerCase().replace(/['.]/g, '').replace(/\bjr\b|\bsr\b|\biii\b|\bii\b|\biv\b/g, '').trim()

    const nq = normalize(q)
    const results = cachedPlayers
      .filter(p => normalize(p.player.name).includes(nq))
      .slice(0, 8)
      .map(p => ({
        name: p.player.name,
        position: p.player.position,
        team: p.player.maybeTeam || p.player.team || '',
        age: p.player.maybeAge ?? p.player.age ?? 0,
        value: p.value,
        rank: p.overallRank,
        trend: p.trend30Day,
        espnId: p.player.espnId || null,
        sleeperId: p.player.sleeperId || null,
      }))

    return NextResponse.json(results)
  } catch {
    return NextResponse.json([])
  }
}

