import 'server-only'

import { prisma } from '@/lib/prisma'
import { buildApiCacheKey } from '@/lib/api-performance'
import { dbFirstMode } from '@/lib/db-first-mode'
import {
  getEffectiveLeagueRosterTemplate,
  starterEligiblePlayerPositionsFromTemplate,
} from '@/lib/league/getEffectiveLeagueRosterTemplate'
import { buildAssetPoolFromRosters, computeSuggestedDraftShape } from '@/lib/dispersal-draft/assetPoolBuilder'
import { getCachedSpecialtyDraftPool, type SpecialtyDraftKind } from '@/lib/draft-room/specialty-draft-pool-cache'
import { getCachedMockDraftPool } from '@/lib/mock-draft/mock-draft-pool-cache'
import { rosterFingerprintFromEligible } from '@/lib/draft-room/draft-pool-eligible-positions'
import { getResolvedDraftPoolForLeague, type PoolType } from '@/lib/draft-room/getResolvedDraftPoolForLeague'

type WarmArgs = {
  leagueId: string | null
  draftId: string | null
  mockDraftId: string | null
  specialtyKind: SpecialtyDraftKind | null
  sport: string | null
  season: string | null
  draftKind: string | null
  scoring: string | null
  teamCount: number | null
  poolType: PoolType | null
  sourceRosterIds: string[]
  participantRosterIds: string[]
  pickTimeSeconds: number | null
  orderMode: string | null
  limit: number
}

type SyncJobRunRecord = {
  id: string
}

function parseArg(name: string): string | null {
  const i = process.argv.findIndex((v) => v === name)
  if (i === -1) return null
  return process.argv[i + 1] ?? null
}

function parseCsvArg(name: string): string[] {
  const value = parseArg(name)
  if (!value) return []
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
}

function parseArgs(): WarmArgs {
  const draftKind = parseArg('--draftKind')
  const specialtyKindRaw = parseArg('--specialtyKind') ?? draftKind
  const explicitPoolType = parseArg('--poolType')
  const parsedTeamCount = Number.parseInt(parseArg('--teamCount') ?? '', 10)
  const parsedPickTimeSeconds = Number.parseInt(parseArg('--pickTimeSeconds') ?? '', 10)
  const specialtyKind =
    specialtyKindRaw === 'dispersal' ||
    specialtyKindRaw === 'supplemental' ||
    specialtyKindRaw === 'rookie' ||
    specialtyKindRaw === 'specialty'
      ? specialtyKindRaw
      : null
  let poolType: PoolType | null = null

  if (explicitPoolType === 'college' || explicitPoolType === 'pro') {
    poolType = explicitPoolType
  } else if (draftKind) {
    const normalized = draftKind.toLowerCase()
    if (normalized.includes('college') || normalized.startsWith('devy')) {
      poolType = 'college'
    } else if (normalized.includes('pro')) {
      poolType = 'pro'
    }
  }

  const parsedLimit = Number.parseInt(parseArg('--limit') ?? '300', 10)
  const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 500) : 300

  return {
    leagueId: parseArg('--leagueId'),
    draftId: parseArg('--draftId'),
    mockDraftId: parseArg('--mockDraftId'),
    specialtyKind,
    sport: parseArg('--sport'),
    season: parseArg('--season'),
    draftKind,
    scoring: parseArg('--scoring'),
    teamCount: Number.isFinite(parsedTeamCount) ? parsedTeamCount : null,
    poolType,
    sourceRosterIds: parseCsvArg('--sourceRosterIds'),
    participantRosterIds: parseCsvArg('--participantRosterIds'),
    pickTimeSeconds: Number.isFinite(parsedPickTimeSeconds) ? parsedPickTimeSeconds : null,
    orderMode: parseArg('--orderMode'),
    limit,
  }
}

async function resolveLeagueId(args: WarmArgs): Promise<string> {
  if (args.mockDraftId) {
    const mockDraft = await prisma.mockDraft.findUnique({
      where: { id: args.mockDraftId },
      select: { leagueId: true },
    })
    if (mockDraft?.leagueId) return mockDraft.leagueId
  }
  if (args.leagueId) return args.leagueId
  if (!args.draftId) throw new Error('Provide --leagueId or --draftId')

  const draft = await prisma.draftSession.findUnique({
    where: { id: args.draftId },
    select: { leagueId: true },
  })
  if (!draft?.leagueId) {
    throw new Error(`Draft session not found for --draftId=${args.draftId}`)
  }
  return draft.leagueId
}

function buildRouteCacheKey(params: {
  leagueId: string
  limit: number
  poolType: PoolType | null
  rosterFingerprint: string
}): string {
  const url = new URL(`http://localhost/api/leagues/${params.leagueId}/draft/pool`)
  if (params.limit > 0) {
    url.searchParams.set('limit', String(params.limit))
  }
  if (params.poolType) {
    url.searchParams.set('poolType', params.poolType)
  }

  return `draft_pool:${params.leagueId}:${params.rosterFingerprint}:dbmerge_v4:nflproj_v1:${buildApiCacheKey('GET', url.toString())}`
}

async function createJobRun(args: WarmArgs, leagueId: string): Promise<SyncJobRunRecord | null> {
  const model = (prisma as any).syncJobRun
  if (!model?.create) {
    return null
  }

  const row = await model.create({
    data: {
      jobName: 'draft_pool_cache_warm',
      jobScope: leagueId,
      trigger: 'manual',
      status: 'running',
      metadata: {
        leagueId,
        draftId: args.draftId,
        mockDraftId: args.mockDraftId,
        sport: args.sport,
        season: args.season,
        draftKind: args.draftKind,
        scoring: args.scoring,
        teamCount: args.teamCount,
        poolType: args.poolType,
        limit: args.limit,
      },
      startedAt: new Date(),
    },
    select: { id: true },
  })

  return row as SyncJobRunRecord
}

async function markJobRunComplete(input: {
  jobRun: SyncJobRunRecord | null
  status: 'success' | 'failed'
  startedMs: number
  rowsRead: number
  rowsWritten: number
  rowsSkipped: number
  metadata?: Record<string, unknown>
  errorMessage?: string | null
}): Promise<void> {
  if (!input.jobRun?.id) return

  const model = (prisma as any).syncJobRun
  if (!model?.update) return

  const completedAt = new Date()
  const durationMs = Math.max(0, Date.now() - input.startedMs)

  await model.update({
    where: { id: input.jobRun.id },
    data: {
      status: input.status,
      rowsRead: input.rowsRead,
      rowsWritten: input.rowsWritten,
      rowsSkipped: input.rowsSkipped,
      metadata: input.metadata ?? undefined,
      errorMessage: input.errorMessage ?? null,
      completedAt,
      durationMs,
    },
  })
}

async function main(): Promise<void> {
  const args = parseArgs()
  const startedMs = Date.now()
  let rowsRead = 0
  let rowsWritten = 0
  let rowsSkipped = 0
  let jobRun: SyncJobRunRecord | null = null

  try {
    if (args.specialtyKind) {
      if (args.specialtyKind !== 'dispersal') {
        throw new Error(`Specialty warm is only implemented for dispersal right now. Received --specialtyKind=${args.specialtyKind}`)
      }
      if (!args.leagueId) {
        throw new Error('Provide --leagueId when warming a specialty draft pool')
      }
      if (args.sourceRosterIds.length === 0) {
        throw new Error('Provide --sourceRosterIds for dispersal specialty warm')
      }

      const league = await prisma.league.findUnique({
        where: { id: args.leagueId },
        select: { sport: true, scoring: true, season: true },
      })
      if (!league) {
        throw new Error(`League not found for --leagueId=${args.leagueId}`)
      }

      jobRun = await createJobRun(args, args.leagueId)

      const allRosters = await prisma.roster.findMany({
        where: { leagueId: args.leagueId },
        select: { id: true, platformUserId: true },
      })
      const sourceRosterIds = [...new Set(args.sourceRosterIds)].sort()
      const participantRosterIds = args.participantRosterIds.length > 0
        ? [...new Set(args.participantRosterIds)].sort()
        : allRosters.map((row) => row.id).sort()
      const participantCount = args.teamCount ?? participantRosterIds.length
      const pickTimeSeconds = args.pickTimeSeconds ?? 120
      const orderMode = args.orderMode ?? 'randomized'

      const { payload, meta } = await getCachedSpecialtyDraftPool({
        kind: 'dispersal',
        leagueId: args.leagueId,
        draftId: args.draftId,
        season: args.season ?? (league.season != null ? String(league.season) : null),
        sport: args.sport ?? league.sport ?? null,
        draftType: args.draftKind ?? 'linear',
        scoring: args.scoring ?? league.scoring ?? null,
        poolType: 'dispersal_assets',
        teamCount: participantCount,
        limit: args.limit,
        scopeParts: [
          ...sourceRosterIds,
          'participants',
          ...participantRosterIds,
          'pickTime',
          pickTimeSeconds,
          'orderMode',
          orderMode,
        ],
        forceRefresh: true,
      }, async () => {
        const pool = await buildAssetPoolFromRosters(args.leagueId!, sourceRosterIds)
        const { suggestedRounds, suggestedPicksPerRound } = computeSuggestedDraftShape(pool.assets, participantCount)
        const totalPicks = suggestedRounds * participantCount
        return {
          assets: pool.assets,
          playerCount: pool.playerCount,
          draftPickCount: pool.draftPickCount,
          totalFaab: pool.totalFaab,
          totalAssets: pool.totalCount,
          suggestedRounds,
          suggestedPicksPerRound,
          assetCount: pool.assets.length,
          participantCount,
          totalRounds: suggestedRounds,
          totalPicks,
          estimatedDurationMinutes: Math.ceil((totalPicks * pickTimeSeconds) / 60),
          assetsPreview: pool.assets.slice(0, 10),
          orderMode,
        }
      })

      rowsRead = Number(payload.totalAssets ?? payload.count ?? 0)
      rowsWritten = Number(payload.totalAssets ?? payload.count ?? 0)
      rowsSkipped = 0

      await markJobRunComplete({
        jobRun,
        status: 'success',
        startedMs,
        rowsRead,
        rowsWritten,
        rowsSkipped,
        metadata: {
          specialtyKind: args.specialtyKind,
          leagueId: args.leagueId,
          draftId: args.draftId,
          cacheKey: meta.cacheKey,
          source: meta.source,
          sourceRosterIds,
          participantRosterIds,
          participantCount,
          pickTimeSeconds,
          orderMode,
          ttlSeconds: meta.ttlSeconds,
        },
      })

      console.log('[draft-pool:cache:warm] success')
      console.log(JSON.stringify({
        specialtyKind: args.specialtyKind,
        leagueId: args.leagueId,
        draftId: args.draftId,
        cacheKey: meta.cacheKey,
        rowsRead,
        rowsWritten,
        ttlSeconds: meta.ttlSeconds,
      }))
      return
    }

    if (args.mockDraftId) {
      const mockDraft = await prisma.mockDraft.findUnique({
        where: { id: args.mockDraftId },
        select: { id: true, leagueId: true, metadata: true },
      })
      if (!mockDraft) {
        throw new Error(`Mock draft not found for --mockDraftId=${args.mockDraftId}`)
      }

      const metadata = mockDraft.metadata && typeof mockDraft.metadata === 'object'
        ? (mockDraft.metadata as Record<string, unknown>)
        : {}
      const type = String(metadata.leagueType ?? 'redraft').toLowerCase().includes('dynasty') ? 'dynasty' : 'redraft'
      const pool = String(metadata.poolType ?? 'all')
      const sport = String(args.sport ?? metadata.sport ?? 'NFL')
      const draftType = String(args.draftKind ?? metadata.draftType ?? 'snake')
      const scoring = String(args.scoring ?? metadata.scoringFormat ?? 'default')
      const teamCount = args.teamCount ?? (typeof metadata.numTeams === 'number' ? metadata.numTeams : 12)

      jobRun = await createJobRun(args, mockDraft.leagueId ?? `mock:${mockDraft.id}`)

      const { payload, meta } = await getCachedMockDraftPool({
        action: 'live',
        type,
        pool,
        sport,
        limit: args.limit,
        leagueId: mockDraft.leagueId,
        mockDraftId: mockDraft.id,
        draftType,
        scoring,
        teamCount,
        season: args.season,
        forceRefresh: true,
      })

      rowsRead = Number(payload.count ?? 0)
      rowsWritten = Number(payload.count ?? 0)
      rowsSkipped = 0

      await markJobRunComplete({
        jobRun,
        status: 'success',
        startedMs,
        rowsRead,
        rowsWritten,
        rowsSkipped,
        metadata: {
          mockDraftId: mockDraft.id,
          leagueId: mockDraft.leagueId,
          cacheKey: meta.cacheKey,
          source: meta.source,
          sport,
          type,
          pool,
          draftType,
          scoring,
          teamCount,
          ttlSeconds: Math.max(1, dbFirstMode.draftPoolCacheTtlSeconds),
        },
      })

      console.log('[draft-pool:cache:warm] success')
      console.log(JSON.stringify({
        mockDraftId: mockDraft.id,
        leagueId: mockDraft.leagueId,
        cacheKey: meta.cacheKey,
        rowsRead,
        rowsWritten,
        ttlSeconds: Math.max(1, dbFirstMode.draftPoolCacheTtlSeconds),
      }))
      return
    }

    const leagueId = await resolveLeagueId(args)
    const effectiveLeagueTemplate = await getEffectiveLeagueRosterTemplate(leagueId)
    const starterEligible = starterEligiblePlayerPositionsFromTemplate(effectiveLeagueTemplate.template)
    const rosterFp = `${effectiveLeagueTemplate.hasPersistedRosterSchema ? 'cfg' : 'nocfg'}:starters:${rosterFingerprintFromEligible(
      starterEligible.size > 0 ? starterEligible : new Set(effectiveLeagueTemplate.allowedPositions)
    )}`

    jobRun = await createJobRun(args, leagueId)

    const resolved = await getResolvedDraftPoolForLeague(leagueId, {
      limit: args.limit,
      poolType: args.poolType,
      effectiveLeagueTemplate,
    })

    const payload = resolved.rosterConfigurationIncomplete
      ? {
          entries: [],
          sport: resolved.sport,
          count: 0,
          rosterConfigurationIncomplete: true as const,
          isIdp: resolved.isIdp,
        }
      : {
          entries: resolved.entries,
          sport: resolved.sport,
          count: resolved.count,
          rosterConfigurationIncomplete: false as const,
          poolType: resolved.poolType,
          devyConfig: resolved.devyConfig,
          c2cConfig: resolved.c2cConfig,
          isIdp: resolved.isIdp,
        }

    const cacheKey = buildRouteCacheKey({
      leagueId,
      limit: args.limit,
      poolType: args.poolType,
      rosterFingerprint: rosterFp,
    })

    const ttlSeconds = Math.max(1, dbFirstMode.draftPoolCacheTtlSeconds)
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000)

    const draftPoolCacheModel = (prisma as any).draftPoolCache
    if (!draftPoolCacheModel?.upsert) {
      throw new Error('DraftPoolCache model is unavailable on Prisma client. Run prisma generate after schema sync.')
    }

    await draftPoolCacheModel.upsert({
      where: { cacheKey },
      create: {
        leagueId,
        cacheKey,
        sport: payload.sport,
        poolType: (payload as { poolType?: string }).poolType ?? null,
        sourceFingerprint: rosterFp,
        entryCount: Number(payload.count ?? 0),
        payload: payload as object,
        expiresAt,
      },
      update: {
        sport: payload.sport,
        poolType: (payload as { poolType?: string }).poolType ?? null,
        sourceFingerprint: rosterFp,
        entryCount: Number(payload.count ?? 0),
        payload: payload as object,
        syncedAt: new Date(),
        expiresAt,
      },
    })

    rowsRead = Number(payload.count ?? 0)
    rowsWritten = Number(payload.count ?? 0)
    rowsSkipped = 0

    await markJobRunComplete({
      jobRun,
      status: 'success',
      startedMs,
      rowsRead,
      rowsWritten,
      rowsSkipped,
      metadata: {
        leagueId,
        cacheKey,
        rosterConfigurationIncomplete: Boolean((payload as { rosterConfigurationIncomplete?: boolean }).rosterConfigurationIncomplete),
        ttlSeconds,
        sport: payload.sport,
        poolType: (payload as { poolType?: string }).poolType ?? null,
        draftId: args.draftId,
        mockDraftId: args.mockDraftId,
        season: args.season,
        draftKind: args.draftKind,
        scoring: args.scoring,
        teamCount: args.teamCount,
      },
    })

    console.log('[draft-pool:cache:warm] success')
    console.log(JSON.stringify({
      leagueId,
      cacheKey,
      rowsRead,
      rowsWritten,
      ttlSeconds,
      rosterConfigurationIncomplete: Boolean((payload as { rosterConfigurationIncomplete?: boolean }).rosterConfigurationIncomplete),
    }))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await markJobRunComplete({
      jobRun,
      status: 'failed',
      startedMs,
      rowsRead,
      rowsWritten,
      rowsSkipped,
      errorMessage: message,
      metadata: {
        draftId: args.draftId,
        mockDraftId: args.mockDraftId,
        leagueId: args.leagueId,
        sport: args.sport,
        season: args.season,
        draftKind: args.draftKind,
        scoring: args.scoring,
        teamCount: args.teamCount,
        poolType: args.poolType,
      },
    })
    console.error('[draft-pool:cache:warm] failed:', message)
    process.exit(1)
  }
}

void main()
