import 'server-only'

import { prisma } from '@/lib/prisma'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { SUPPORTED_SPORTS, normalizeToSupportedSport, type SupportedSport } from '@/lib/sport-scope'
import {
  assertTeamCodeFits,
  normalizePlayerName,
  normalizePositionForSport,
  normalizeTeamCode,
  type TeamCodeNormalization,
} from '@/lib/team-abbrev'
import { apiChain } from '@/lib/workers/api-chain'

const SPORTS_PLAYER_TTL_MS = 6 * 60 * 60 * 1000
const UPSERT_BATCH_SIZE = 100

/**
 * Wall-clock budget for the whole import, kept under the route's `maxDuration = 300`.
 * The margin leaves room for the per-sport stale-fallback write to land after we stop.
 */
const IMPORT_BUDGET_MS = 240_000

/**
 * Ceiling for the two live provider calls per sport (projections, rankings).
 *
 * These are the only genuinely external operations in the per-sport `Promise.all`; the other
 * seven are local Prisma reads. Before this, a provider that hung had no ceiling at all —
 * measured in production 2026-07-20, `rolling-insights` returned "Probe timeout after 30000ms"
 * on nfl/projections and the function was killed at 300s with a 504, having written nothing.
 */
const PROVIDER_FETCH_TIMEOUT_MS = 25_000

/**
 * Resolve `value`, or fall back to `onTimeout` if it takes longer than `ms`.
 *
 * Deliberately does NOT reject: `apiChain.fetch` already degrades through cached/DB tiers, so a
 * slow provider should look like "no rows from this provider" rather than failing the whole
 * `Promise.all` and losing the sport's other eight results.
 */
async function withTimeout<T>(value: Promise<T>, ms: number, label: string, onTimeout: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      value,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => {
          console.warn(`[sports-data-importer] ${label} exceeded ${ms}ms — continuing without it`)
          resolve(onTimeout)
        }, ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

type PlayerSeed = {
  id: string
  name: string
  team: string
  position: string
  status?: string | null
  source: string
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function currentSeasonForSport(): number {
  return new Date().getFullYear()
}

// SportsPlayerRecord.id is @db.VarChar(128); fallback ids embed name+team, which for college
// inputs can push past it. Overlong ids keep a deterministic 120-char prefix + 8-char suffix
// derived from the full string so re-imports stay idempotent.
const PLAYER_ID_MAX_LENGTH = 128

function boundPlayerId(id: string): string {
  if (id.length <= PLAYER_ID_MAX_LENGTH) return id
  let hash = 0
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return `${id.slice(0, PLAYER_ID_MAX_LENGTH - 9)}:${hash.toString(36).padStart(8, '0').slice(0, 8)}`
}

function buildPlayerId(sport: string, rawId: string | null | undefined, name: string, team?: string | null): string {
  if (rawId) return boundPlayerId(`${sport}:${rawId}`)
  const slug = normalizePlayerName(name).replace(/\s+/g, '-')
  return boundPlayerId(`${sport}:${slug}:${team || 'FA'}`)
}

/** Per-sport tally of how team codes were resolved — surfaced in the import report so
 * `truncated_fallback` growth is visible instead of silent. */
export type TeamCodeCounts = Record<TeamCodeNormalization, number>

function emptyTeamCodeCounts(): TeamCodeCounts {
  return { canonical: 0, provider_code: 0, mapped: 0, derived: 0, truncated_fallback: 0, missing: 0 }
}

interface TeamCodeContext {
  sport: SupportedSport
  teamCodeMap: ReadonlyMap<string, string>
  counts: TeamCodeCounts
}

/** Resolve a raw provider team value to a ≤32-char code, tallying how it resolved. */
function resolveTeamCode(ctx: TeamCodeContext, rawTeam: string | null | undefined): string {
  const result = normalizeTeamCode({ sport: ctx.sport, rawTeam, teamCodeMap: ctx.teamCodeMap })
  ctx.counts[result.normalization] += 1
  return result.code ?? 'FA'
}

/** Build the UPPERCASED SportsTeam.name → shortName map used as the provider-code tier. */
async function loadTeamCodeMap(sport: SupportedSport): Promise<Map<string, string>> {
  const teams = await prisma.sportsTeam.findMany({
    where: { sport },
    select: { name: true, shortName: true },
  })
  const map = new Map<string, string>()
  for (const team of teams) {
    const short = team.shortName?.trim()
    if (team.name && short) map.set(team.name.trim().toUpperCase(), short)
  }
  return map
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

function asArrayRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
    : []
}

async function fetchProviderPlayerSeeds(sport: SupportedSport, season: number, teamCtx: TeamCodeContext): Promise<PlayerSeed[]> {
  const response = await apiChain.fetch({
    sport,
    dataType: 'players',
    query: { season: String(season) },
  })

  const rows = asArrayRecords(response.data)
  const seeds: PlayerSeed[] = []
  for (const row of rows) {
    const name = String(row.name ?? row.playerName ?? row.player ?? '').trim()
    if (!name) continue

    const team = resolveTeamCode(teamCtx, String(row.team ?? row.teamAbbrev ?? ''))
    const position = normalizePositionForSport(sport, String(row.position ?? row.pos ?? '')) ?? 'FLEX'
    const externalId = String(row.id ?? row.externalId ?? row.playerId ?? '').trim() || null

    seeds.push({
      id: buildPlayerId(sport, externalId, name, team),
      name,
      team,
      position,
      status: typeof row.status === 'string' ? row.status : null,
      source: response.source,
    })
  }

  return seeds
}

async function loadIdentitySeeds(sport: SupportedSport, teamCtx: TeamCodeContext): Promise<PlayerSeed[]> {
  const rows = await prisma.playerIdentityMap.findMany({
    where: { sport },
    select: {
      canonicalName: true,
      currentTeam: true,
      position: true,
      sleeperId: true,
      clearSportsId: true,
      status: true,
    },
    take: 5000,
  })

  return rows
    .map((row) => ({
      id: buildPlayerId(sport, row.sleeperId ?? row.clearSportsId ?? null, row.canonicalName, row.currentTeam),
      name: row.canonicalName,
      team: resolveTeamCode(teamCtx, row.currentTeam),
      position: normalizePositionForSport(sport, row.position) ?? 'FLEX',
      status: row.status,
      source: 'manual',
    }))
    .filter((row) => Boolean(row.name))
}

function buildProjectionMap(rows: Array<Record<string, unknown>>): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>()
  for (const row of rows) {
    const name = String(row.name ?? row.playerName ?? row.player ?? '').trim()
    if (!name) continue
    map.set(normalizePlayerName(name), row)
  }
  return map
}

function buildDynastyValueMap(rows: Array<Record<string, unknown>>): Map<string, number> {
  const map = new Map<string, number>()
  rows.forEach((row, index) => {
    const name = String(row.name ?? row.playerName ?? row.player ?? '').trim()
    if (!name) return
    const explicit = Number(row.dynasty_value ?? row.dynastyValue ?? row.score ?? row.value)
    const derived = Number.isFinite(explicit) ? explicit : clamp(100 - index, 1, 100)
    map.set(normalizePlayerName(name), Math.round(clamp(derived, 1, 100)))
  })
  return map
}

export async function runSportsDataImporter(options?: {
  sports?: string[]
}): Promise<{
  imported: number
  sports: string[]
  staleFallbackApplied: boolean
  skippedSports: string[]
  durationMs: number
  teamCodeCounts: Record<string, TeamCodeCounts>
  rowsSkippedByGuard: number
}> {
  const targetSports = (options?.sports?.length ? options.sports : SUPPORTED_SPORTS).map((sport) =>
    normalizeToSupportedSport(sport)
  )
  const uniqueSports = Array.from(new Set(targetSports))
  let imported = 0
  let staleFallbackApplied = false

  const startedAt = Date.now()
  const skippedSports: string[] = []
  const teamCodeCounts: Record<string, TeamCodeCounts> = {}
  let rowsSkippedByGuard = 0

  for (const sport of uniqueSports) {
    /**
     * Per-sport budget. The loop is sequential and NFL is first in SUPPORTED_SPORTS, so before
     * this a sport whose providers hung consumed the entire function and every sport behind it
     * never ran at all. That is not hypothetical: NBA, NHL, MLB and SOCCER sat at 2026-04-26 in
     * production — frozen the day these crons stopped being deployed — while NFL kept getting
     * partial updates from other paths. Stopping early leaves those sports untouched rather
     * than starved, and the next scheduled run reaches them.
     */
    if (Date.now() - startedAt > IMPORT_BUDGET_MS) {
      skippedSports.push(sport)
      console.warn(
        `[sports-data-importer] budget exhausted (${IMPORT_BUDGET_MS}ms) — skipping ${sport}`,
      )
      continue
    }

    const season = currentSeasonForSport()

    // Name → shortName map first: it's the tier that keeps full college institution names out
    // of the VarChar(32) team column (SportsTeam.shortName covers 100% of NCAAF/NCAAB in prod).
    const teamCtx: TeamCodeContext = {
      sport,
      teamCodeMap: await loadTeamCodeMap(sport),
      counts: emptyTeamCodeCounts(),
    }
    teamCodeCounts[sport] = teamCtx.counts

    const [identitySeeds, providerSeeds, latestStats, latestInjuries, latestNews, latestAdp, metaTrends, projectionsResponse, rankingsResponse] =
      await Promise.all([
        loadIdentitySeeds(sport, teamCtx),
        fetchProviderPlayerSeeds(sport, season, teamCtx),
        prisma.playerSeasonStats.findMany({
          where: { sport },
          orderBy: { fetchedAt: 'desc' },
          take: 4000,
          select: { playerId: true, playerName: true, stats: true },
        }),
        prisma.injuryReportRecord.findMany({
          where: { sport },
          orderBy: { reportDate: 'desc' },
          take: 2500,
        }),
        prisma.playerNewsRecord.findMany({
          where: { sport },
          orderBy: { publishedAt: 'desc' },
          take: 2500,
        }),
        prisma.adpDataRecord.findMany({
          where: { sport },
          orderBy: [{ season: 'desc' }, { week: 'desc' }, { createdAt: 'desc' }],
          take: 4000,
        }),
        prisma.playerMetaTrend.findMany({
          where: { sport },
          take: 4000,
        }),
        withTimeout(
          apiChain.fetch({ sport, dataType: 'projections', query: { season: String(season) } }),
          PROVIDER_FETCH_TIMEOUT_MS,
          `${sport} projections`,
          // `apiChain.fetch` returns `ApiResult`, not `ChainFetchResult`: it has no `fromCache`,
          // and `source`/`latency` are required. Mirror the module's own empty-result shape
          // (see the `chain.error && !chain.data` branch in api-chain.ts). Functionally inert —
          // with `data: null` the projection map is empty, so `.source` is never read downstream.
          { data: null, source: 'cache', latency: 0, cached: false, error: 'provider timeout' },
        ),
        withTimeout(
          apiChain.fetch({ sport, dataType: 'rankings', query: { season: String(season) } }),
          PROVIDER_FETCH_TIMEOUT_MS,
          `${sport} rankings`,
          { data: null, source: 'cache', latency: 0, cached: false, error: 'provider timeout' },
        ),
      ])

    const projectionRows = asArrayRecords(projectionsResponse.data)
    const rankingRows = asArrayRecords(rankingsResponse.data)

    const seedMap = new Map<string, PlayerSeed>()
    for (const seed of [...identitySeeds, ...providerSeeds]) {
      const key = normalizePlayerName(seed.name)
      if (!key) continue
      if (!seedMap.has(key) || seed.source !== 'manual') seedMap.set(key, seed)
    }

    for (const row of latestAdp) {
      const key = normalizePlayerName(row.playerName)
      if (!seedMap.has(key)) {
        seedMap.set(key, {
          id: buildPlayerId(sport, row.playerId, row.playerName, row.team),
          name: row.playerName,
          team: resolveTeamCode(teamCtx, row.team),
          position: normalizePositionForSport(sport, row.position) ?? 'FLEX',
          source: row.source,
        })
      }
    }

    for (const row of latestInjuries) {
      const key = normalizePlayerName(row.playerName)
      if (!seedMap.has(key)) {
        seedMap.set(key, {
          id: buildPlayerId(sport, row.playerId, row.playerName, row.team),
          name: row.playerName,
          team: resolveTeamCode(teamCtx, row.team),
          position: 'FLEX',
          status: row.status,
          source: 'cached',
        })
      }
    }

    const projectionMap = buildProjectionMap(projectionRows)
    const dynastyValueMap = buildDynastyValueMap(rankingRows)
    const statMap = new Map<string, unknown>()
    const injuryMap = new Map<string, (typeof latestInjuries)[number]>()
    const adpMap = new Map<string, (typeof latestAdp)[number]>()
    const newsMap = new Map<string, Array<(typeof latestNews)[number]>>()
    const trendMap = new Map<string, number>(
      metaTrends.map((row) => [String(row.playerId), Number(row.trendScore ?? 0)])
    )

    for (const row of latestStats) {
      const key = normalizePlayerName(row.playerName)
      if (!statMap.has(key)) statMap.set(key, row.stats)
    }
    for (const row of latestInjuries) {
      const key = normalizePlayerName(row.playerName)
      if (!injuryMap.has(key)) injuryMap.set(key, row)
    }
    for (const row of latestAdp) {
      const key = normalizePlayerName(row.playerName)
      if (!adpMap.has(key)) adpMap.set(key, row)
    }
    for (const row of latestNews) {
      const key = normalizePlayerName(row.playerName)
      const current = newsMap.get(key) ?? []
      if (current.length < 3) current.push(row)
      newsMap.set(key, current)
    }

    const rows = Array.from(seedMap.values()).flatMap((seed) => {
      const key = normalizePlayerName(seed.name)
      const injury = injuryMap.get(key)
      const adp = adpMap.get(key)
      const trendScore = trendMap.get(adp?.playerId ?? '')
      const projections = projectionMap.get(key) ?? {}
      const news = (newsMap.get(key) ?? []).map((item) => ({
        headline: item.headline,
        impact: item.impact,
        source: item.source,
        publishedAt: item.publishedAt.toISOString(),
      }))

      // Schema-boundary guard: every VarChar-bounded field is enforced here so ONE bad row is
      // skipped and reported instead of throwing inside the batch transaction and aborting the
      // entire sport's import — which is exactly how NCAAF/NCAAB stayed at 5,226/100 rows while
      // their source tables held 44,897/18,209.
      try {
        return [{
          id: seed.id,
          sport,
          name: seed.name.slice(0, 128),
          team: assertTeamCodeFits(seed.team) ?? 'FA',
          position: (seed.position || 'FLEX').slice(0, 32),
          stats: asRecord(statMap.get(key)) ?? {},
          projections,
          adp: adp?.adp ?? null,
          dynastyValue:
            dynastyValueMap.get(key) ??
            (typeof trendScore === 'number' ? Math.round(clamp(50 + trendScore, 0, 100)) : null),
          injuryStatus: injury?.status?.slice(0, 32) ?? seed.status?.slice(0, 32) ?? null,
          injuryNotes: injury?.notes ?? null,
          news,
          dataSource: (projectionMap.has(key) ? projectionsResponse.source : seed.source).slice(0, 32),
        }]
      } catch (guardError) {
        rowsSkippedByGuard += 1
        console.error('[sports-data-importer] row skipped by schema guard', {
          sport,
          player: seed.name,
          error: guardError instanceof Error ? guardError.message : String(guardError),
        })
        return []
      }
    })

    try {
      for (const batch of chunk(rows, UPSERT_BATCH_SIZE)) {
        await prisma.$transaction(
          batch.map((row) =>
            prisma.sportsPlayerRecord.upsert({
              where: { id: row.id },
              update: {
                sport: row.sport,
                name: row.name,
                team: row.team,
                position: row.position,
                stats: toPrismaJsonInput(row.stats),
                projections: toPrismaJsonInput(row.projections),
                adp: row.adp,
                dynastyValue: row.dynastyValue,
                injuryStatus: row.injuryStatus,
                injuryNotes: row.injuryNotes,
                news: toPrismaJsonInput(row.news),
                dataSource: row.dataSource,
              },
              create: {
                ...row,
                stats: toPrismaJsonInput(row.stats),
                projections: toPrismaJsonInput(row.projections),
                news: toPrismaJsonInput(row.news),
              },
            })
          )
        )
      }
      imported += rows.length
    } catch (error) {
      staleFallbackApplied = true
      await prisma.sportsPlayerRecord.updateMany({
        where: {
          sport,
          lastUpdated: {
            lt: new Date(Date.now() - SPORTS_PLAYER_TTL_MS),
          },
        },
        data: {
          dataSource: 'cached',
        },
      })
      console.error('[sports-data-importer] Failed to import player data', {
        sport,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return {
    imported,
    sports: uniqueSports,
    staleFallbackApplied,
    skippedSports,
    durationMs: Date.now() - startedAt,
    teamCodeCounts,
    rowsSkippedByGuard,
  }
}
