import { createHash } from 'crypto'

import { fetchAllFFCFormats, fetchFFCADP, getLiveADP, type FFCScoringFormat } from '@/lib/adp-data'
import { dbFirstMode } from '@/lib/db-first-mode'
import { normalizePlayerList } from '@/lib/draft-asset-pipeline'
import { injuryCoverageFor, resolveInjuryFacts } from '@/lib/injuries/injuryReadPort'
import { findMultiADP, type ADPFormat } from '@/lib/multi-platform-adp'
import { normalizePlayerName } from '@/lib/team-abbrev'
import { loadSportAwareDraftPlayerPool } from '@/lib/mock-draft/sport-player-pool'
import { prisma } from '@/lib/prisma'
import { resolveSleeperIds } from '@/lib/sleeper/players-cache'
import { DEFAULT_SPORT, normalizeToSupportedSport } from '@/lib/sport-scope'

type MockDraftPoolType = 'dynasty' | 'redraft'

type MockDraftPoolSource = 'db-cache' | 'rebuilt'

export type MockDraftPoolRequest = {
  action?: string | null
  type?: string | null
  pool?: string | null
  sport?: string | null
  limit?: number | null
  leagueId?: string | null
  mockDraftId?: string | null
  draftType?: string | null
  scoring?: string | null
  teamCount?: number | null
  season?: string | null
  forceRefresh?: boolean
}

export type MockDraftPoolPayload = {
  entries: unknown[]
  count: number
  type: MockDraftPoolType
  pool: string
  sport: string
  source?: string
  formats?: Record<string, { count: number; meta: unknown }>
  meta?: unknown
  message?: string
}

export type MockDraftPoolMeta = {
  source: MockDraftPoolSource
  cacheKey: string
  cachedAt: string | null
}

function normalizeCacheText(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function normalizeLimit(value: number | null | undefined): number {
  if (!Number.isFinite(Number(value))) return 300
  return Math.min(Math.max(Number(value), 1), 500)
}

function normalizeTeamCount(value: number | null | undefined): number {
  if (!Number.isFinite(Number(value))) return 0
  return Math.max(0, Number(value))
}

function buildDateBucket(value: string | null | undefined): string {
  const normalized = normalizeCacheText(value)
  return normalized || new Date().getUTCFullYear().toString()
}

function buildScoringHash(value: string | null | undefined): string {
  const normalized = normalizeCacheText(value || 'default') || 'default'
  return createHash('sha1').update(normalized).digest('hex').slice(0, 10)
}

function buildScope(params: MockDraftPoolRequest): string {
  if (params.mockDraftId) return `session:${normalizeCacheText(params.mockDraftId)}`
  if (params.leagueId) return `league:${normalizeCacheText(params.leagueId)}`
  return 'context:shared'
}

function buildCacheLeagueId(params: MockDraftPoolRequest): string {
  if (params.mockDraftId) return `mock:${params.mockDraftId}`
  if (params.leagueId) return `mock:${params.leagueId}`
  return 'mock:shared'
}

function buildSourceFingerprint(params: MockDraftPoolRequest): string {
  return [
    `sport:${normalizeToSupportedSport(params.sport || DEFAULT_SPORT)}`,
    `type:${params.type === 'dynasty' ? 'dynasty' : 'redraft'}`,
    `pool:${normalizeCacheText(params.pool || 'all') || 'all'}`,
    `draftType:${normalizeCacheText(params.draftType || 'snake') || 'snake'}`,
    `score:${buildScoringHash(params.scoring)}`,
    `teams:${normalizeTeamCount(params.teamCount)}`,
    `season:${buildDateBucket(params.season)}`,
  ].join('|')
}

export function buildMockDraftPoolCacheKey(params: MockDraftPoolRequest): string {
  const sport = normalizeToSupportedSport(params.sport || DEFAULT_SPORT).toLowerCase()
  const type = params.type === 'dynasty' ? 'dynasty' : 'redraft'
  const pool = normalizeCacheText(params.pool || 'all') || 'all'
  const draftType = normalizeCacheText(params.draftType || 'snake') || 'snake'
  const teamCount = normalizeTeamCount(params.teamCount)
  const season = buildDateBucket(params.season)
  const scoringHash = buildScoringHash(params.scoring)
  return `mock:${buildScope(params)}:${sport}:${season}:${type}:${pool}:${draftType}:score:${scoringHash}:teams:${teamCount}:limit:${normalizeLimit(params.limit)}`
}

function logMockPool(message: string, details: Record<string, unknown>): void {
  console.info(`[mock-draft/pool] ${message}`, details)
}

async function buildMockPoolPayload(params: MockDraftPoolRequest): Promise<MockDraftPoolPayload> {
  const action = params.action || 'live'
  const limit = normalizeLimit(params.limit)
  const sport = normalizeToSupportedSport(params.sport || DEFAULT_SPORT)
  const type: MockDraftPoolType = params.type === 'dynasty' ? 'dynasty' : 'redraft'
  const pool = params.pool || 'all'

  if (action === 'ffc') {
    const validFormats: FFCScoringFormat[] = ['standard', 'ppr', 'half-ppr', '2qb', 'dynasty', 'rookie']
    const formatParam = params.scoring || 'standard'
    const format = validFormats.includes(formatParam as FFCScoringFormat)
      ? (formatParam as FFCScoringFormat)
      : 'standard'
    const teams = normalizeTeamCount(params.teamCount) || 12
    const { players, meta } = await fetchFFCADP(format, teams)
    return {
      entries: players.slice(0, limit),
      count: players.length,
      meta,
      source: 'fantasyfootballcalculator.com',
      type,
      pool,
      sport: sport.toLowerCase(),
    }
  }

  if (action === 'ffc-all') {
    const teams = normalizeTeamCount(params.teamCount) || 12
    const allFormats = await fetchAllFFCFormats(teams)
    const formats: Record<string, { count: number; meta: unknown }> = {}
    for (const [format, data] of Object.entries(allFormats)) {
      formats[format] = { count: data.players.length, meta: data.meta }
    }
    return {
      formats,
      entries: [],
      count: 0,
      source: 'fantasyfootballcalculator.com',
      type,
      pool,
      sport: sport.toLowerCase(),
    }
  }

  if (sport !== 'NFL') {
    const players = await loadSportAwareDraftPlayerPool({
      sport,
      leagueId: params.leagueId,
      limit,
    })
    const raw = players.map((player) => ({
      name: player.name,
      position: player.position,
      team: player.team,
      adp: player.adp,
      playerId: player.playerId ?? null,
      injuryStatus: null,
    }))
    const normalized = normalizePlayerList(raw, sport)
    return {
      entries: players.map((player, index) => ({
        name: player.name,
        position: player.position,
        team: player.team,
        adp: player.adp,
        adpFormatted: player.adp != null ? Number(player.adp).toFixed(1) : null,
        adpTrend: null,
        value: player.value ?? null,
        sleeperId: player.playerId ?? null,
        ffcPlayerId: null,
        timesDrafted: null,
        adpHigh: null,
        adpLow: null,
        adpStdev: null,
        bye: null,
        isRookie: false,
        multiPlatformADP: null,
        playerId: player.playerId ?? null,
        byeWeek: normalized[index]?.byeWeek ?? null,
        injuryStatus: normalized[index]?.injuryStatus ?? null,
        display: normalized[index]?.display ?? null,
        assets: normalized[index]?.display?.assets ?? null,
        teamLogoUrl: normalized[index]?.display?.assets?.teamLogoUrl ?? null,
        headshotUrl: normalized[index]?.display?.assets?.headshotUrl ?? null,
      })),
      count: players.length,
      type,
      pool,
      sport: sport.toLowerCase(),
      message: players.length > 0
        ? `Loaded ${players.length} ${sport} players from the sport-specific player pool.`
        : `No ${sport} players are available in the imported player pool yet.`,
    }
  }

  let entries: Awaited<ReturnType<typeof getLiveADP>> = []

  if (pool === 'rookie') {
    const [devyEntries, ffcRookies] = await Promise.all([
      getLiveADP('devy', limit).catch(() => []),
      fetchFFCADP('rookie', 12).then((result) => result.players).catch(() => []),
    ])
    const seen = new Set<string>()
    for (const entry of devyEntries) {
      seen.add(entry.name.toLowerCase())
      entries.push(entry)
    }
    for (const entry of ffcRookies) {
      if (seen.has(entry.name.toLowerCase())) continue
      seen.add(entry.name.toLowerCase())
      entries.push(entry)
    }
    entries.sort((left, right) => left.adp - right.adp)
    entries = entries.slice(0, limit)
  } else if (pool === 'vet') {
    entries = await getLiveADP(type, limit)
    entries = entries.filter((entry) => entry.source !== 'devy' && entry.source !== 'rookie-db')
  } else if (pool === 'combined') {
    const [nflEntries, devyEntries] = await Promise.all([
      getLiveADP(type, limit),
      getLiveADP('devy', Math.floor(limit / 2)).catch(() => []),
    ])
    const seen = new Set<string>()
    for (const entry of nflEntries) {
      seen.add(entry.name.toLowerCase())
      entries.push(entry)
    }
    for (const entry of devyEntries) {
      if (seen.has(entry.name.toLowerCase())) continue
      seen.add(entry.name.toLowerCase())
      entries.push(entry)
    }
    entries.sort((left, right) => left.adp - right.adp)
    entries = entries.slice(0, limit)
  } else {
    entries = await getLiveADP(type, limit)
  }

  let sleeperIdMap: Record<string, string> = {}
  try {
    sleeperIdMap = await resolveSleeperIds(entries.map((entry) => entry.name))
  } catch {
    sleeperIdMap = {}
  }

  const adpFormat: ADPFormat = type === 'dynasty' ? 'dynasty' : 'redraft'
  const rawNormalized = entries.map((entry) => ({
    name: entry.name,
    position: entry.position,
    team: entry.team,
    adp: entry.adp,
    byeWeek: entry.bye ?? null,
    playerId: sleeperIdMap[entry.name] || null,
  }))
  const normalized = normalizePlayerList(rawNormalized, sport)

  /*
   * 🛑 INJURIES COME FROM THE INJURY FEED, NOT FROM A CSV FROZEN IN MARCH.
   *
   * This used to read `findMultiADP(...)?.health`, i.e. the Health/Injury columns of
   * `data/nfl-adp-multiplatform.csv` — a hand-placed export dated 2026-03-08. Two consequences,
   * both bad on a draft board two weeks before the season:
   *   - every badge was up to six months old, and a stale injury badge is a confident false
   *     statement rather than a missing one;
   *   - it was gated `!isRookie`, so the 2026 class got no injury line at all — and the CSV
   *     predates their draft, so it could never have had one.
   *
   * `resolveInjuryFacts` reads `sports_injuries` (ESPN + Rolling Insights), keyed on the same
   * normalizer, in ONE batched query for the whole pool rather than per player.
   */
  const coverage = injuryCoverageFor(sport)
  const injuries = coverage.covered
    ? await resolveInjuryFacts({
        sport,
        players: entries.map((e) => ({ name: e.name, position: e.position, team: e.team })),
      }).catch(() => null)
    : null

  return {
    entries: entries.map((entry, index) => {
      const isRookie = entry.source === 'devy' || entry.source === 'rookie-db'
      const multiPlatform = !isRookie ? findMultiADP(entry.name, entry.position, entry.team || undefined) : null
      /*
       * A STALE ROW IS SUPPRESSED, NOT RENDERED. The read port's own contract says so: this
       * board shows a plain badge with no age beside it, so an old designation reads as
       * current. `ambiguous` names are already withheld by the port rather than guessed.
       */
      const fact = injuries?.byPlayer.get(normalizePlayerName(entry.name)) ?? null
      const injuryStatus = fact && !fact.stale ? fact.status : null
      const display = normalized[index]?.display ?? null
      return {
        name: entry.name,
        position: entry.position,
        team: entry.team,
        adp: entry.adp,
        adpFormatted: entry.adpFormatted,
        adpTrend: entry.adpTrend,
        value: entry.value,
        sleeperId: sleeperIdMap[entry.name] || null,
        ffcPlayerId: entry.ffcPlayerId,
        timesDrafted: entry.timesDrafted,
        adpHigh: entry.adpHigh,
        adpLow: entry.adpLow,
        adpStdev: entry.adpStdev,
        bye: entry.bye,
        isRookie,
        playerId: sleeperIdMap[entry.name] || null,
        byeWeek: normalized[index]?.byeWeek ?? entry.bye ?? null,
        injuryStatus: injuryStatus != null ? String(injuryStatus) : null,
        display,
        assets: display?.assets ?? null,
        teamLogoUrl: display?.assets?.teamLogoUrl ?? null,
        headshotUrl: display?.assets?.headshotUrl ?? null,
        multiPlatformADP: multiPlatform ? {
          format: adpFormat,
          consensus: multiPlatform.consensus,
          platformCount: multiPlatform.platformCount,
          spread: multiPlatform.adpSpread,
          redraft: multiPlatform.redraft,
          dynastyADP: multiPlatform.dynasty.sleeper,
          dynasty2QBADP: multiPlatform.dynasty2QB.sleeper,
          aav: multiPlatform.aav.mfl ?? multiPlatform.aav.espn ?? null,
          health: multiPlatform.health.status || multiPlatform.health.injury ? multiPlatform.health : null,
        } : null,
      }
    }),
    count: entries.length,
    type,
    pool,
    sport: sport.toLowerCase(),
  }
}

export async function getCachedMockDraftPool(params: MockDraftPoolRequest): Promise<{ payload: MockDraftPoolPayload; meta: MockDraftPoolMeta }> {
  const cacheKey = buildMockDraftPoolCacheKey(params)
  const draftPoolCacheModel = (prisma as { draftPoolCache?: { findFirst: Function; upsert: Function } }).draftPoolCache

  if (!params.forceRefresh && draftPoolCacheModel?.findFirst) {
    const cached = await draftPoolCacheModel.findFirst({
      where: { cacheKey, expiresAt: { gt: new Date() } },
      select: { payload: true, syncedAt: true },
    })
    if (cached?.payload && typeof cached.payload === 'object') {
      logMockPool('cache hit', { cacheKey })
      return {
        payload: cached.payload as MockDraftPoolPayload,
        meta: {
          source: 'db-cache',
          cacheKey,
          cachedAt: cached.syncedAt instanceof Date ? cached.syncedAt.toISOString() : null,
        },
      }
    }
  }

  logMockPool('cache miss', { cacheKey })
  const rebuildStartedAt = Date.now()
  const payload = await buildMockPoolPayload(params)
  logMockPool('rebuild complete', { cacheKey, durationMs: Date.now() - rebuildStartedAt })

  if (draftPoolCacheModel?.upsert) {
    const ttlSeconds = Math.max(1, dbFirstMode.draftPoolCacheTtlSeconds)
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000)
    await draftPoolCacheModel.upsert({
      where: { cacheKey },
      create: {
        leagueId: buildCacheLeagueId(params),
        cacheKey,
        sport: normalizeToSupportedSport(params.sport || DEFAULT_SPORT),
        poolType: params.pool || null,
        sourceFingerprint: buildSourceFingerprint(params),
        entryCount: Number(payload.count ?? 0),
        payload: payload as unknown as object,
        expiresAt,
      },
      update: {
        sport: normalizeToSupportedSport(params.sport || DEFAULT_SPORT),
        poolType: params.pool || null,
        sourceFingerprint: buildSourceFingerprint(params),
        entryCount: Number(payload.count ?? 0),
        payload: payload as unknown as object,
        syncedAt: new Date(),
        expiresAt,
      },
    })
    logMockPool('persisted DraftPoolCache row', { cacheKey, entryCount: Number(payload.count ?? 0) })
  }

  return {
    payload,
    meta: {
      source: 'rebuilt',
      cacheKey,
      cachedAt: new Date().toISOString(),
    },
  }
}