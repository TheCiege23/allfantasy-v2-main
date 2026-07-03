import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueMember } from '@/lib/league/league-access'
import { soccerLeagueHintFromLeagueSettings } from '@/lib/player-data/leagueSoccerLeagueHint'
import { getNormalizedPlayerData } from '@/lib/player-data/getNormalizedPlayerData'
import { resolveIncludePlayerDataDiagnostics } from '@/lib/player-data/providerFallbackDiagnostics'
import { serializeUnifiedPlayerForApi } from '@/lib/player-data/serializeUnifiedPlayerForApi'

export const dynamic = 'force-dynamic'

function normalizePosition(value: string | null): string | undefined {
  const trimmed = String(value ?? '').trim().toUpperCase()
  if (!trimmed || trimmed === 'ALL') return undefined
  return trimmed
}

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const seasonId = req.nextUrl.searchParams?.get('seasonId')?.trim()
  if (!seasonId) return NextResponse.json({ error: 'seasonId required' }, { status: 400 })

  const season = await prisma.redraftSeason.findFirst({
    where: { id: seasonId },
    select: {
      id: true,
      leagueId: true,
      sport: true,
      season: true,
      league: { select: { settings: true } },
    },
  })
  if (!season) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const gate = await assertLeagueMember(season.leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const search = req.nextUrl.searchParams?.get('search')?.trim() ?? null
  const position = normalizePosition(req.nextUrl.searchParams?.get('position'))
  const teamId = req.nextUrl.searchParams?.get('teamId')?.trim() || null
  const playerId = req.nextUrl.searchParams?.get('playerId')?.trim() || null
  const limit = Math.min(800, Math.max(1, Number(req.nextUrl.searchParams?.get('limit') ?? '200') || 200))
  const includeDiagnostics = resolveIncludePlayerDataDiagnostics(req.nextUrl.searchParams)

  const rows = await getNormalizedPlayerData({
    surface: playerId ? 'player_card' : 'waivers',
    leagueId: season.leagueId,
    limit: playerId ? 1 : limit,
    playerIds: playerId ? [playerId] : undefined,
    waiverSearch: playerId ? undefined : search,
    waiverPosition: playerId ? undefined : position,
    waiverTeamId: playerId ? undefined : teamId,
    soccerLeague: soccerLeagueHintFromLeagueSettings(season.league.settings ?? null) ?? undefined,
    includeProviderFallbackDiagnostics: includeDiagnostics,
  })

  const players = rows.map(serializeUnifiedPlayerForApi)
  if (playerId) {
    const player = players[0] ?? null
    const canonical = player?.nflRedraft ?? null
    return NextResponse.json({
      player,
      playerData: canonical,
      canonicalNflRedraft: canonical,
      projections: canonical?.currentProjection ?? null,
      injury: canonical?.injury ?? null,
      news: canonical?.news ?? null,
      media: canonical?.media ?? null,
      seasonId: season.id,
      leagueId: season.leagueId,
      sport: season.sport,
      seasonYear: season.season,
      source: 'normalized_player_data',
    })
  }

  const rookies = players.filter((player) => player.product.isRookie === true)
  const veterans = players.filter((player) => player.product.isRookie !== true)

  return NextResponse.json({
    players,
    rookies,
    veterans,
    seasonId: season.id,
    leagueId: season.leagueId,
    sport: season.sport,
    seasonYear: season.season,
    source: 'normalized_player_data',
    count: players.length,
    rookieCount: rookies.length,
    veteranCount: veterans.length,
  })
}
