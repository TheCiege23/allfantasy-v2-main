/**
 * Phase 2 — the canonical read path.
 *
 * `getCanonicalPlayer(id)` is the single server-side call that Phase 3 will swap the 86
 * `getAllPlayers()` call sites onto. It assembles the whole player object — profile, primary
 * image, latest season stats, projections, outlook, news, injury, and the cross-platform id
 * map — from the canonical tables in one batched round trip, instead of re-resolving anything
 * live per request.
 *
 * ── Live resolution is the exception, not the path ──
 * If a player has no `PlayerImage` row (a new signing, or someone the backfill missed) we fall
 * back to the provider chain exactly once and Phase 1's write-through persists the result, so
 * the next read is a pure DB hit. Pass `skipLiveFallback` to guarantee zero network calls.
 *
 * ── A note on where the satellites live ──
 * Stats, injuries and news are canonical (`sports_core_*`). Projections and outlook are not:
 * they live in `fantasy_projections` and `ai_player_outlooks_cache`, which predate the
 * canonical family. They still key on a plain `playerId` string, so once canonical ids are
 * what gets written everywhere they line up without a schema change. Note that
 * `PlayerOutlook` (`player_outlooks`) is deliberately NOT used here — it is user-scoped
 * (`userId` is required), so it cannot answer "the outlook for this player" without a viewer.
 * `AiPlayerOutlookCache` is the global one.
 */

import { prisma } from '@/lib/prisma'
import { readPrimaryPlayerImage, type StoredPlayerImage } from '@/lib/player-assets/playerImageStore'
import { readPrimaryTeamImage, type StoredTeamImage } from '@/lib/sport-teams/teamImageStore'
import { resolvePlayerHeadshot } from '@/lib/player-assets/resolvePlayerHeadshot'

export interface CanonicalPlayerProjection {
  season: string
  week: number
  projectedPoints: number
  source: string
}

export interface CanonicalPlayerNews {
  headline: string
  url: string | null
  publishedAt: Date | null
}

export interface CanonicalPlayer {
  id: string
  name: string
  sport: string
  position: string
  team: string | null
  active: boolean
  height: string | null
  weight: string | null
  injuryStatus: string | null

  image: StoredPlayerImage | null
  seasonStats: {
    seasonKey: string
    seasonType: string
    stats: unknown
    fantasyPoints: number | null
    gamesPlayed: number | null
    source: string | null
  } | null
  projections: CanonicalPlayerProjection[]
  outlook: { payload: unknown; expiresAt: Date } | null
  news: CanonicalPlayerNews[]
  injury: { status: string | null; bodyPart: string | null; description: string | null } | null

  /** Cross-platform ids: `{ sleeper: "4034", espn: "3139477", ... }`. */
  providerIds: Record<string, string>

  meta: {
    /** True when the image was resolved live on this call and persisted for next time. */
    resolvedLiveImage: boolean
    /** Satellites that returned nothing — useful for spotting ingestion gaps. */
    missing: string[]
  }
}

export interface GetCanonicalPlayerOptions {
  /** Never touch the provider chain, even when no image exists. */
  skipLiveFallback?: boolean
  newsLimit?: number
  projectionLimit?: number
}

export async function getCanonicalPlayer(
  id: string,
  opts: GetCanonicalPlayerOptions = {},
): Promise<CanonicalPlayer | null> {
  const playerId = id?.trim()
  if (!playerId) return null

  const newsLimit = opts.newsLimit ?? 5
  const projectionLimit = opts.projectionLimit ?? 5

  const player = await prisma.player.findUnique({ where: { id: playerId } })
  if (!player) return null

  const sportKey = String(player.sport ?? '').toUpperCase()

  // One batched round trip for every satellite.
  const [image, seasonStats, projections, outlook, news, injury, identities] = await Promise.all([
    readPrimaryPlayerImage({ playerId }),
    prisma.playerSeasonStat.findFirst({
      where: { playerId, sportKey },
      orderBy: [{ seasonKey: 'desc' }, { fetchedAt: 'desc' }],
      select: {
        seasonKey: true, seasonType: true, stats: true,
        fantasyPoints: true, gamesPlayed: true, source: true,
      },
    }),
    prisma.fantasyProjection.findMany({
      where: { playerId, sport: sportKey },
      orderBy: [{ season: 'desc' }, { week: 'desc' }],
      take: projectionLimit,
      select: { season: true, week: true, projectedPoints: true, source: true },
    }),
    prisma.aiPlayerOutlookCache.findFirst({
      where: { playerId, sport: sportKey, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: { outlookPayload: true, expiresAt: true },
    }),
    prisma.playerNewsItem.findMany({
      where: { playerId },
      orderBy: { publishedAt: 'desc' },
      take: newsLimit,
      select: { headline: true, url: true, publishedAt: true },
    }),
    // NOTE: InjuryReport has no `publishedAt` — its recency column is `reportDate`
    // (`sports_core_injury_reports`). Ordering by publishedAt here throws at runtime.
    prisma.injuryReport.findFirst({
      where: { playerId },
      orderBy: [{ reportDate: 'desc' }, { fetchedAt: 'desc' }],
      select: { status: true, bodyPart: true, description: true },
    }),
    prisma.playerProviderIdentity.findMany({
      where: { playerId },
      select: { provider: true, providerPlayerId: true },
    }),
  ])

  let resolvedImage = image
  let resolvedLiveImage = false

  // Only genuinely unmapped players pay the provider cost, and only once.
  if (!resolvedImage && !opts.skipLiveFallback) {
    const live = await resolvePlayerHeadshot({
      name: player.name,
      sport: sportKey,
      team: player.team,
      position: player.position,
      playerId,
    })
    if (live.imageUrl) {
      resolvedLiveImage = true
      resolvedImage = await readPrimaryPlayerImage({ playerId })
    }
  }

  const missing: string[] = []
  if (!resolvedImage) missing.push('image')
  if (!seasonStats) missing.push('seasonStats')
  if (projections.length === 0) missing.push('projections')
  if (!outlook) missing.push('outlook')
  if (news.length === 0) missing.push('news')
  if (!injury) missing.push('injury')

  return {
    id: player.id,
    name: player.name,
    sport: sportKey,
    position: player.position,
    team: player.team,
    active: player.active,
    height: player.height,
    weight: player.weight,
    injuryStatus: player.injuryStatus,

    image: resolvedImage,
    seasonStats: seasonStats
      ? {
          seasonKey: seasonStats.seasonKey,
          seasonType: seasonStats.seasonType,
          stats: seasonStats.stats,
          fantasyPoints: seasonStats.fantasyPoints,
          gamesPlayed: seasonStats.gamesPlayed,
          source: seasonStats.source,
        }
      : null,
    projections: projections.map((p) => ({
      season: p.season,
      week: p.week,
      projectedPoints: p.projectedPoints,
      source: p.source,
    })),
    outlook: outlook ? { payload: outlook.outlookPayload, expiresAt: outlook.expiresAt } : null,
    news: news.map((n) => ({ headline: n.headline, url: n.url, publishedAt: n.publishedAt })),
    injury: injury
      ? { status: injury.status, bodyPart: injury.bodyPart, description: injury.description }
      : null,

    providerIds: Object.fromEntries(
      identities.map((i) => [i.provider, i.providerPlayerId]),
    ),

    meta: { resolvedLiveImage, missing },
  }
}

export interface CanonicalTeam {
  id: string
  sportKey: string
  leagueKey: string | null
  canonicalName: string
  shortName: string | null
  abbreviation: string | null
  city: string | null
  conference: string | null
  division: string | null
  active: boolean
  logo: StoredTeamImage | null
  providerIds: Record<string, string>
  meta: { missing: string[] }
}

export async function getCanonicalTeam(id: string): Promise<CanonicalTeam | null> {
  const teamId = id?.trim()
  if (!teamId) return null

  const team = await prisma.team.findUnique({ where: { id: teamId } })
  if (!team) return null

  const [logo, identities] = await Promise.all([
    readPrimaryTeamImage({ teamId }),
    prisma.teamProviderIdentity.findMany({
      where: { teamId },
      select: { provider: true, providerTeamId: true },
    }),
  ])

  const missing: string[] = []
  if (!logo) missing.push('logo')

  return {
    id: team.id,
    sportKey: team.sportKey,
    leagueKey: team.leagueKey,
    canonicalName: team.canonicalName,
    shortName: team.shortName,
    abbreviation: team.abbreviation,
    city: team.city,
    conference: team.conference,
    division: team.division,
    active: team.active,
    logo,
    providerIds: Object.fromEntries(identities.map((i) => [i.provider, i.providerTeamId])),
    meta: { missing },
  }
}
