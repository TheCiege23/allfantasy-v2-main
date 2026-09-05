import { NextRequest, NextResponse } from 'next/server'
import { getFantasyCalcValuesDbFirst } from '@/lib/fantasycalc-db'
import { searchPlayers } from '@/lib/data/players'
import { SUPPORTED_SPORTS, normalizeToSupportedSport, type SupportedSport } from '@/lib/sport-scope'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import { resolveHeadshotUrl } from '@/lib/draft-sports-models/player-asset-resolver'
import { directionFor } from '@/lib/trade-intel/playerStock'

let fcCache: { players: Awaited<ReturnType<typeof getFantasyCalcValuesDbFirst>>; at: number } | null = null
const FC_TTL = 5 * 60 * 1000

async function searchNflFantasyCalc(q: string) {
  const now = Date.now()
  if (!fcCache || now - fcCache.at > FC_TTL) {
    const fresh = await getFantasyCalcValuesDbFirst({ isDynasty: true, numQbs: 1, numTeams: 12, ppr: 1 })
    fcCache = { players: fresh, at: now }
  }
  const normalize = (s: string) =>
    s.toLowerCase().replace(/['.]/g, '').replace(/\bjr\b|\bsr\b|\biii\b|\bii\b|\biv\b/g, '').trim()
  const nq = normalize(q)
  return (fcCache?.players ?? [])
    .filter((p) => normalize(p.player.name).includes(nq))
    .slice(0, 8)
    .map((p) => ({
      kind: 'player' as const,
      sport: 'NFL' as const,
      /*
       * 🛑 THESE THREE WERE HARDCODED null AND THE DATA WAS ALREADY IN HAND.
       * `FantasyCalcPlayerIdentity` carries `sleeperId`, and `FantasyCalcPlayer` carries
       * `trend30Day` — the same number `ingestPlayerValues` writes into
       * `PlayerValueSnapshot.trend30d`, so a player shows the SAME arrow whether he was
       * picked off a roster or found by search. No name-join, no extra query.
       */
      playerId: p.player.sleeperId || null,
      name: p.player.name,
      position: p.player.position,
      team: p.player.maybeTeam ?? '',
      headshotUrl: resolveHeadshotUrl(p.player.sleeperId || null, 'NFL'),
      /*
       * ⚠ NULL WHEN THERE IS NO READING, never 'flat'. `directionFor` answers 'flat' for a
       * non-finite input, which is the right answer for a measured zero and the WRONG answer
       * for a player nobody has measured — so the finite check happens here, not there.
       */
      stock: Number.isFinite(p.trend30Day) ? directionFor(p.trend30Day, p.value) : null,
      stockDelta: Number.isFinite(p.trend30Day) ? p.trend30Day : null,
      value: p.value,
      rank: p.overallRank,
      source: 'fantasycalc',
    }))
}

export async function GET(req: NextRequest) {
  const ip = getClientIp(req as any) || 'unknown'
  const rl = rateLimit(`trade-value-search:${ip}`, 80, 60_000)
  if (!rl.success) {
    return NextResponse.json({ error: 'Rate limited' }, { status: 429 })
  }

  const q = req.nextUrl.searchParams.get('q')?.trim() ?? ''
  const sportParam = req.nextUrl.searchParams.get('sport')?.trim() ?? 'ALL'
  if (q.length < 2) {
    return NextResponse.json([])
  }

  try {
    if (sportParam === 'NFL') {
      const fc = await searchNflFantasyCalc(q.toLowerCase())
      return NextResponse.json(fc)
    }

    if (sportParam === 'ALL') {
      const nfl = await searchNflFantasyCalc(q.toLowerCase())
      const restSports = SUPPORTED_SPORTS.filter((s) => s !== 'NFL')
      const rest = await Promise.all(
        restSports.map(async (s) => {
          const rows = await searchPlayers(q, s)
          return rows.slice(0, 5).map((row) => ({
            kind: 'player' as const,
            sport: s as SupportedSport,
            playerId: row.id,
            name: row.name,
            position: row.position,
            team: row.team,
            headshotUrl: row.headshotUrl ?? row.headshotUrlLg ?? row.headshotUrlSm,
            value: row.dynastyValue ?? null,
            rank: null as number | null,
            source: row.dataSource,
          }))
        }),
      )
      return NextResponse.json([...nfl, ...rest.flat()].slice(0, 24))
    }

    const sp = normalizeToSupportedSport(sportParam)
    const rows = await searchPlayers(q, sp)
    return NextResponse.json(
      rows.slice(0, 12).map((row) => ({
        kind: 'player' as const,
        sport: sp,
        playerId: row.id,
        name: row.name,
        position: row.position,
        team: row.team,
        headshotUrl: row.headshotUrl ?? row.headshotUrlLg ?? row.headshotUrlSm,
        value: row.dynastyValue ?? null,
        rank: null as number | null,
        source: row.dataSource,
      })),
    )
  } catch {
    return NextResponse.json([])
  }
}
