import { NextRequest, NextResponse } from 'next/server'
import { getFantasyCalcValuesDbFirst } from '@/lib/fantasycalc-db'
import { searchPlayers } from '@/lib/data/players'
import { SUPPORTED_SPORTS, normalizeToSupportedSport, type SupportedSport } from '@/lib/sport-scope'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import { resolveHeadshotUrl } from '@/lib/draft-sports-models/player-asset-resolver'
import { directionFor } from '@/lib/trade-intel/playerStock'
import { playerUnpricedReason } from '@/lib/trade-value/unpricedReason'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { loadLeagueForTrade } from '@/lib/trade-value-console/league-loader'
import { resolveLeagueTradeChart, type LeagueTradeChart } from '@/lib/trade-value-console/leagueTradePricing'
import { sportsRecordToPricedAsset } from '@/lib/trade-value-console/sports-db-valuation'

let fcCache: { players: Awaited<ReturnType<typeof getFantasyCalcValuesDbFirst>>; at: number } | null = null
const FC_TTL = 5 * 60 * 1000

async function searchNflFantasyCalc(q: string, chart: LeagueTradeChart | null) {
  const now = Date.now()
  if (!chart && (!fcCache || now - fcCache.at > FC_TTL)) {
    const fresh = await getFantasyCalcValuesDbFirst({ isDynasty: true, numQbs: 1, numTeams: 12, ppr: 1 })
    fcCache = { players: fresh, at: now }
  }
  const normalize = (s: string) =>
    s.toLowerCase().replace(/['.]/g, '').replace(/\bjr\b|\bsr\b|\biii\b|\bii\b|\biv\b/g, '').trim()
  const nq = normalize(q)
  const marketRows = (chart?.fcPlayers ?? fcCache?.players ?? [])
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
      providerIdentity: p.player.sleeperId ? { provider: 'sleeper' as const, id: p.player.sleeperId, position: p.player.position } : undefined,
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
  const marketIds = new Set(marketRows.map(row => row.playerId))
  const leagueRows = [...(chart?.nflCtx.leagueValueBySleeperId ?? [])]
    .filter(([id, row]) => !marketIds.has(id) && row.name && normalize(row.name).includes(nq))
    .map(([id, row]) => ({
      kind: 'player' as const, sport: 'NFL' as const, playerId: id,
      providerIdentity: { provider: 'sleeper' as const, id, position: row.position },
      name: row.name!, position: row.position, team: '',
      headshotUrl: resolveHeadshotUrl(id, 'NFL'), stock: null, stockDelta: null,
      value: row.value, rank: null, source: row.basis,
    }))
  return [...marketRows, ...leagueRows].slice(0, 12)
}

/**
 * Why a non-NFL search row carries no value. The row came back from the player table, so the player
 * is identified; the NFL branch never needs this, because every row there comes FROM the value feed.
 */
function unpricedReasonForRow(row: { dynastyValue?: number | null; position?: string | null; sport?: string | null }) {
  return playerUnpricedReason({ identified: true, position: row.position, sport: row.sport, marketLoaded: true })
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
    const leagueId = req.nextUrl.searchParams.get('leagueId')?.trim()
    let chart: LeagueTradeChart | null = null
    if (leagueId) {
      const session = await getServerSession(authOptions)
      const userId = session?.user?.id
      if (!userId) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
      const leagueRow = await loadLeagueForTrade({ leagueId, userId })
      if (!leagueRow) return NextResponse.json({ error: 'League unavailable' }, { status: 404 })
      if (sportParam === 'NFL' || sportParam === 'ALL') {
        chart = await resolveLeagueTradeChart({
          leagueRow, leagueSnapshot: null, leagueNormCtx: null,
          overrides: { leagueSize: leagueRow.leagueSize ?? 12 },
        })
      }
    }
    if (sportParam === 'NFL') {
      const fc = await searchNflFantasyCalc(q.toLowerCase(), chart)
      return NextResponse.json(fc)
    }

    if (sportParam === 'ALL') {
      const nfl = await searchNflFantasyCalc(q.toLowerCase(), chart)
      const restSports = SUPPORTED_SPORTS.filter((s) => s !== 'NFL')
      const rest = await Promise.all(
        restSports.map(async (s) => {
          const rows = await searchPlayers(q, s)
          return rows.slice(0, 5).map((row) => {
            const priced = sportsRecordToPricedAsset(row)
            return ({
            kind: 'player' as const,
            sport: s as SupportedSport,
            playerId: row.id,
            name: row.name,
            position: row.position,
            team: row.team,
            headshotUrl: row.headshotUrl ?? row.headshotUrlLg ?? row.headshotUrlSm,
            value: priced?.assetValue.marketValue ?? null,
            unpricedReason: priced ? null : unpricedReasonForRow(row),
            rank: null as number | null,
            source: row.dataSource,
          })})
        }),
      )
      return NextResponse.json([...nfl, ...rest.flat()].slice(0, 24))
    }

    const sp = normalizeToSupportedSport(sportParam)
    const rows = await searchPlayers(q, sp)
    return NextResponse.json(
      rows.slice(0, 12).map((row) => {
        const priced = sportsRecordToPricedAsset(row)
        return ({
        kind: 'player' as const,
        sport: sp,
        playerId: row.id,
        name: row.name,
        position: row.position,
        team: row.team,
        headshotUrl: row.headshotUrl ?? row.headshotUrlLg ?? row.headshotUrlSm,
        value: priced?.assetValue.marketValue ?? null,
        unpricedReason: priced ? null : unpricedReasonForRow(row),
        rank: null as number | null,
        source: row.dataSource,
      })}),
    )
  } catch {
    return NextResponse.json([])
  }
}
