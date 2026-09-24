import { buildHeadshotUrl, getTeamLogoUrl } from './player-media-urls'

export type { SportKey } from './player-media-urls'
export { sleeperHeadshotUrl, sleeperTeamLogoUrl, normalizeTeamAbbr } from './player-media-urls'

export interface PlayerMedia {
  headshotUrl: string | null
  teamLogoUrl: string | null
}

export interface StandardPlayer {
  playerId: string
  fullName: string
  position: string
  teamAbbr: string | null
  sport: string
  media: PlayerMedia
}

export interface ResolvedPlayerMedia {
  playerId: string
  sport: string
  teamAbbr: string | null
  media: PlayerMedia
  source: 'db' | 'template'
}

interface CacheEntry<T> {
  data: T
  expiresAt: number
}

const PLAYER_CACHE = new Map<string, CacheEntry<ResolvedPlayerMedia>>()
const TEAM_CACHE = new Map<string, CacheEntry<PlayerMedia>>()
const CACHE_TTL_MS = 6 * 60 * 60 * 1000

function cacheKey(playerId: string, sport: string): string {
  return `${sport}:${playerId}`
}

function teamCacheKey(teamAbbr: string, sport: string): string {
  return `${sport}:team:${teamAbbr}`
}

function buildMediaFromTemplate(playerId: string | null, teamAbbr: string | null, sport: string = 'nfl'): PlayerMedia {
  return {
    headshotUrl: buildHeadshotUrl(playerId, sport),
    teamLogoUrl: getTeamLogoUrl(teamAbbr, sport),
  }
}

async function getPrismaClient() {
  const mod = await import('@/lib/prisma')
  return mod.prisma
}

export function buildPlayerMedia(
  playerId: string | null,
  teamAbbr: string | null,
  sport: string = 'nfl'
): PlayerMedia {
  return buildMediaFromTemplate(playerId, teamAbbr, sport)
}

export function attachTeamMedia(teamAbbr: string | null, sport: string = 'nfl'): PlayerMedia {
  if (!teamAbbr) return { headshotUrl: null, teamLogoUrl: null }

  const ck = teamCacheKey(teamAbbr, sport)
  const cached = TEAM_CACHE.get(ck)
  if (cached && cached.expiresAt > Date.now()) return cached.data

  const media: PlayerMedia = {
    headshotUrl: null,
    teamLogoUrl: getTeamLogoUrl(teamAbbr, sport),
  }

  TEAM_CACHE.set(ck, { data: media, expiresAt: Date.now() + CACHE_TTL_MS })
  return media
}

export async function attachPlayerMedia(player: {
  playerId: string
  teamAbbr?: string | null
  sport?: string
}): Promise<ResolvedPlayerMedia> {
  const sport = player.sport || 'nfl'
  const ck = cacheKey(player.playerId, sport)

  const cached = PLAYER_CACHE.get(ck)
  if (cached && cached.expiresAt > Date.now()) return cached.data

  let dbTeamAbbr: string | null = null
  let dbImageUrl: string | null = null
  let dbTeamLogoUrl: string | null = null
  let source: 'db' | 'template' = 'template'

  try {
    const prisma = await getPrismaClient()
    const identity = await prisma.playerIdentityMap.findFirst({
      where: { sleeperId: player.playerId },
      select: { currentTeam: true },
    })

    if (identity?.currentTeam) {
      dbTeamAbbr = identity.currentTeam
      source = 'db'
    }

    if (!dbImageUrl) {
      const sportsPlayer = await prisma.sportsPlayer.findFirst({
        where: { sleeperId: player.playerId, sport: sport.toUpperCase() },
        select: { imageUrl: true, team: true },
        orderBy: { fetchedAt: 'desc' },
      })
      if (sportsPlayer?.imageUrl) {
        dbImageUrl = sportsPlayer.imageUrl
        source = 'db'
      }
      if (sportsPlayer?.team && !dbTeamAbbr) {
        dbTeamAbbr = sportsPlayer.team
        source = 'db'
      }
    }

    const sportsPlayerRecord = await prisma.sportsPlayerRecord.findUnique({
      where: { id: player.playerId },
      select: {
        team: true,
        headshotUrl: true,
        logoUrl: true,
      },
    }).catch(() => null)

    if (sportsPlayerRecord?.headshotUrl) {
      dbImageUrl = sportsPlayerRecord.headshotUrl
      source = 'db'
    }
    if (sportsPlayerRecord?.team && !dbTeamAbbr) {
      dbTeamAbbr = sportsPlayerRecord.team
      source = 'db'
    }
    if (sportsPlayerRecord?.logoUrl) {
      dbTeamLogoUrl = sportsPlayerRecord.logoUrl
      source = 'db'
    }

    const effectiveTeamForLookup = dbTeamAbbr || player.teamAbbr || null
    if (effectiveTeamForLookup) {
      const teamAsset = await prisma.teamAsset.findUnique({
        where: {
          uniq_team_assets_sport_team_code: {
            sport: sport.toUpperCase(),
            teamCode: effectiveTeamForLookup,
          },
        },
        select: { logoUrl: true },
      }).catch(() => null)

      if (teamAsset?.logoUrl) {
        dbTeamLogoUrl = teamAsset.logoUrl
        source = 'db'
      }
    }
  } catch {
    /* DB unavailable — fall through to template */
  }

  const effectiveTeam = dbTeamAbbr || player.teamAbbr || null

  const media: PlayerMedia = {
    headshotUrl: dbImageUrl || buildHeadshotUrl(player.playerId, sport),
    teamLogoUrl: dbTeamLogoUrl || getTeamLogoUrl(effectiveTeam, sport),
  }

  const result: ResolvedPlayerMedia = {
    playerId: player.playerId,
    sport,
    teamAbbr: effectiveTeam,
    media,
    source,
  }

  PLAYER_CACHE.set(ck, { data: result, expiresAt: Date.now() + CACHE_TTL_MS })
  return result
}

export async function attachPlayerMediaBatch(
  players: Array<{
    playerId: string
    teamAbbr?: string | null
    sport?: string
  }>
): Promise<Map<string, ResolvedPlayerMedia>> {
  const results = new Map<string, ResolvedPlayerMedia>()
  const toResolve: Array<{ playerId: string; teamAbbr: string | null; sport: string }> = []

  for (const p of players) {
    const sport = p.sport || 'nfl'
    const ck = cacheKey(p.playerId, sport)
    const cached = PLAYER_CACHE.get(ck)
    if (cached && cached.expiresAt > Date.now()) {
      results.set(p.playerId, cached.data)
    } else {
      toResolve.push({ playerId: p.playerId, teamAbbr: p.teamAbbr || null, sport })
    }
  }

  if (toResolve.length === 0) return results

  const sleeperIds = toResolve.map(p => p.playerId)

  let identityMap = new Map<string, { currentTeam: string | null }>()
  let sportsPlayerMap = new Map<string, { imageUrl: string | null; team: string | null }>()
  let sportsPlayerRecordMap = new Map<string, { headshotUrl: string | null; team: string | null; logoUrl: string | null }>()
  let teamAssetMap = new Map<string, string>()

  try {
    const prisma = await getPrismaClient()
    const identities = await prisma.playerIdentityMap.findMany({
      where: { sleeperId: { in: sleeperIds } },
      select: { sleeperId: true, currentTeam: true },
    })
    for (const id of identities) {
      if (id.sleeperId) identityMap.set(id.sleeperId, { currentTeam: id.currentTeam })
    }

    const sportsPlayers = await prisma.sportsPlayer.findMany({
      where: { sleeperId: { in: sleeperIds } },
      select: { sleeperId: true, imageUrl: true, team: true },
      orderBy: { fetchedAt: 'desc' },
    })
    for (const sp of sportsPlayers) {
      if (sp.sleeperId && !sportsPlayerMap.has(sp.sleeperId)) {
        sportsPlayerMap.set(sp.sleeperId, { imageUrl: sp.imageUrl, team: sp.team })
      }
    }

    const sportsPlayerRecords = await prisma.sportsPlayerRecord.findMany({
      where: { id: { in: sleeperIds } },
      select: { id: true, headshotUrl: true, team: true, logoUrl: true },
    })
    for (const row of sportsPlayerRecords) {
      sportsPlayerRecordMap.set(row.id, {
        headshotUrl: row.headshotUrl,
        team: row.team,
        logoUrl: row.logoUrl,
      })
    }

    const uniqueTeams = Array.from(new Set(toResolve
      .map((player) => {
        const identity = identityMap.get(player.playerId)
        const sportsPlayer = sportsPlayerMap.get(player.playerId)
        const sportsRecord = sportsPlayerRecordMap.get(player.playerId)
        return `${player.sport.toUpperCase()}:${identity?.currentTeam || sportsPlayer?.team || sportsRecord?.team || player.teamAbbr || ''}`
      })
      .filter((key) => key.split(':')[1])))

    if (uniqueTeams.length > 0) {
      const teamAssets = await prisma.teamAsset.findMany({
        where: {
          OR: uniqueTeams.map((entry) => {
            const [sportType, teamCode] = entry.split(':')
            return {
              sport: sportType,
              teamCode,
            }
          }),
        },
        select: { sport: true, teamCode: true, logoUrl: true },
      })

      for (const asset of teamAssets) {
        if (asset.logoUrl) {
          teamAssetMap.set(`${asset.sport}:${asset.teamCode}`, asset.logoUrl)
        }
      }
    }
  } catch {
    /* DB unavailable — fall through to templates */
  }

  for (const p of toResolve) {
    const identity = identityMap.get(p.playerId)
    const sportsPlayer = sportsPlayerMap.get(p.playerId)
    const sportsPlayerRecord = sportsPlayerRecordMap.get(p.playerId)

    const dbTeamAbbr = identity?.currentTeam || sportsPlayer?.team || sportsPlayerRecord?.team || null
    const effectiveTeam = dbTeamAbbr || p.teamAbbr
    const dbImageUrl = sportsPlayerRecord?.headshotUrl || sportsPlayer?.imageUrl || null
    const dbTeamLogoUrl = effectiveTeam
      ? teamAssetMap.get(`${p.sport.toUpperCase()}:${effectiveTeam}`) || sportsPlayerRecord?.logoUrl || null
      : sportsPlayerRecord?.logoUrl || null
    const source: 'db' | 'template' = (dbTeamAbbr || dbImageUrl || dbTeamLogoUrl) ? 'db' : 'template'

    const media: PlayerMedia = {
      headshotUrl: dbImageUrl || buildHeadshotUrl(p.playerId, p.sport),
      teamLogoUrl: dbTeamLogoUrl || getTeamLogoUrl(effectiveTeam, p.sport),
    }

    const result: ResolvedPlayerMedia = {
      playerId: p.playerId,
      sport: p.sport,
      teamAbbr: effectiveTeam,
      media,
      source,
    }

    PLAYER_CACHE.set(cacheKey(p.playerId, p.sport), { data: result, expiresAt: Date.now() + CACHE_TTL_MS })
    results.set(p.playerId, result)
  }

  return results
}

export async function getHistoricalTeam(
  playerId: string,
  season: number,
  week?: number | null,
  sport: string = 'nfl'
): Promise<string | null> {
  try {
    const prisma = await getPrismaClient()
    const effectiveWeek = week ?? 0

    if (effectiveWeek > 0) {
      const exact = await prisma.playerTeamHistory.findUnique({
        where: {
          playerId_sport_season_week: { playerId, sport, season, week: effectiveWeek },
        },
        select: { teamAbbr: true },
      })
      if (exact) return exact.teamAbbr
    }

    const seasonEntry = await prisma.playerTeamHistory.findUnique({
      where: {
        playerId_sport_season_week: { playerId, sport, season, week: 0 },
      },
      select: { teamAbbr: true },
    })
    if (seasonEntry) return seasonEntry.teamAbbr

    return null
  } catch {
    return null
  }
}

export async function attachPlayerMediaHistorical(
  player: { playerId: string; teamAbbr?: string | null; sport?: string },
  season: number,
  week?: number | null
): Promise<ResolvedPlayerMedia> {
  const sport = player.sport || 'nfl'
  const historicalTeam = await getHistoricalTeam(player.playerId, season, week, sport)
  const effectiveTeam = historicalTeam || player.teamAbbr || null

  const media: PlayerMedia = {
    headshotUrl: buildHeadshotUrl(player.playerId, sport),
    teamLogoUrl: getTeamLogoUrl(effectiveTeam, sport),
  }

  return {
    playerId: player.playerId,
    sport,
    teamAbbr: effectiveTeam,
    media,
    source: historicalTeam ? 'db' : 'template',
  }
}

export async function recordTeamHistory(
  playerId: string,
  teamAbbr: string,
  season: number,
  week?: number | null,
  sport: string = 'nfl',
  source: string = 'sleeper'
): Promise<void> {
  try {
    const prisma = await getPrismaClient()
    await prisma.playerTeamHistory.upsert({
      where: {
        playerId_sport_season_week: {
          playerId,
          sport,
          season,
          week: week ?? 0,
        },
      },
      update: { teamAbbr, source },
      create: { playerId, sport, season, week: week ?? 0, teamAbbr, source },
    })
  } catch {
    /* non-critical — best effort */
  }
}

export function toStandardPlayer(
  playerId: string,
  fullName: string,
  position: string,
  teamAbbr: string | null,
): StandardPlayer {
  return {
    playerId,
    fullName,
    position,
    teamAbbr,
    sport: 'nfl',
    media: buildMediaFromTemplate(playerId, teamAbbr, 'nfl'),
  }
}

export function clearMediaCache(): void {
  PLAYER_CACHE.clear()
  TEAM_CACHE.clear()
}
