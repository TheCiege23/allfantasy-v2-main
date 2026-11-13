import 'server-only'

import { prisma } from '@/lib/prisma'
import { runAdpImporter } from '@/lib/workers/adp-importer'
import { SUPPORTED_SPORTS, normalizeToSupportedSport } from '@/lib/sport-scope'

type RefreshTrigger = 'manual' | 'scheduled' | 'cli'

type ProviderCountBucket = {
  providerCount: number
  count: number
}

type AdpRefreshQualitySummary = {
  providerCountDistribution: ProviderCountBucket[]
  singleSourcePercentage: number
  missingSports: string[]
  staleSegmentsOlderThan24h: Array<{
    sport: string
    format: string
    scoring: string
    createdAt: string
  }>
  duplicateGroups: number
  topWarnings: string[]
}

type AdpRefreshServiceResult = {
  runId: string
  startedAt: string
  finishedAt: string
  durationMs: number
  trigger: RefreshTrigger
  sportsProcessed: string[]
  season: number
  week: number
  rawProviderRowsRead: number
  rawProviderRowsInserted: number
  rawProviderRowsSkippedAsDuplicates: number
  consensusRowsInsertedOrUpdated: number
  consensusRowsBySport: Record<string, number>
  providerCountDistribution: ProviderCountBucket[]
  singleSourcePercentage: number
  missingSports: string[]
  staleSegmentsOlderThan24h: Array<{
    sport: string
    format: string
    scoring: string
    createdAt: string
  }>
  duplicateGroups: number
  warnings: string[]
  errors: string[]
}

class AdpRefreshAlreadyRunningError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AdpRefreshAlreadyRunningError'
  }
}

function normalizeSports(input?: string[]): string[] {
  return Array.from(
    new Set((input?.length ? input : SUPPORTED_SPORTS).map((sport) => normalizeToSupportedSport(sport)))
  )
}

async function buildQualitySummary(season: number, week: number, sportsProcessed: string[]): Promise<AdpRefreshQualitySummary> {
  const consensusRows = await prisma.adpDataRecord.findMany({
    where: {
      season,
      week,
      source: 'consensus',
      sport: { in: sportsProcessed },
    },
    select: {
      sport: true,
      format: true,
      scoring: true,
      providerCount: true,
      createdAt: true,
    },
  })

  const providerBuckets = new Map<number, number>()
  let singleSourceCount = 0
  for (const row of consensusRows) {
    const providerCount = Math.max(1, row.providerCount ?? 1)
    providerBuckets.set(providerCount, (providerBuckets.get(providerCount) ?? 0) + 1)
    if (providerCount <= 1) singleSourceCount += 1
  }

  const providerCountDistribution = [...providerBuckets.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([providerCount, count]) => ({ providerCount, count }))

  const staleCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const staleSegmentsOlderThan24h = consensusRows
    .filter((row) => row.createdAt < staleCutoff)
    .slice(0, 25)
    .map((row) => ({
      sport: row.sport,
      format: row.format,
      scoring: row.scoring,
      createdAt: row.createdAt.toISOString(),
    }))

  const duplicateGroups = await prisma.adpDataRecord.groupBy({
    by: ['sport', 'format', 'scoring', 'playerId', 'week', 'season', 'source'],
    where: {
      season,
      week,
      source: 'consensus',
      sport: { in: sportsProcessed },
    },
    _count: { _all: true },
  })

  const consensusSports = new Set(consensusRows.map((row) => row.sport))
  const missingSports = sportsProcessed.filter((sport) => !consensusSports.has(sport))

  const warnings: string[] = []
  if (missingSports.length > 0) warnings.push(`Missing consensus rows for: ${missingSports.join(', ')}`)
  if (staleSegmentsOlderThan24h.length > 0) warnings.push(`Found ${staleSegmentsOlderThan24h.length} stale consensus segment(s) older than 24h`)
  if (duplicateGroups.some((row) => row._count._all > 1)) warnings.push('Duplicate consensus ADP groups detected')
  if (consensusRows.length > 0) {
    const singleSourcePercentage = Number(((singleSourceCount / consensusRows.length) * 100).toFixed(2))
    if (singleSourcePercentage > 50) warnings.push(`High single-source consensus share: ${singleSourcePercentage}%`)
  }

  return {
    providerCountDistribution,
    singleSourcePercentage: consensusRows.length > 0 ? Number(((singleSourceCount / consensusRows.length) * 100).toFixed(2)) : 0,
    missingSports,
    staleSegmentsOlderThan24h,
    duplicateGroups: duplicateGroups.filter((row) => row._count._all > 1).length,
    topWarnings: warnings.slice(0, 10),
  }
}

export async function runAdpRefreshService(input?: {
  trigger?: RefreshTrigger
  sports?: string[]
}): Promise<AdpRefreshServiceResult> {
  const startedAt = new Date()
  const trigger = input?.trigger ?? 'manual'
  const sportsProcessed = normalizeSports(input?.sports)
  const errors: string[] = []

  const runningCutoff = new Date(Date.now() - 2 * 60 * 60 * 1000)
  const activeRun = await prisma.adpRefreshRun.findFirst({
    where: {
      status: 'running',
      startedAt: { gte: runningCutoff },
    },
    orderBy: { startedAt: 'desc' },
    select: { id: true, startedAt: true },
  })

  if (activeRun) {
    throw new AdpRefreshAlreadyRunningError(
      `ADP refresh already running since ${activeRun.startedAt.toISOString()} (run ${activeRun.id})`
    )
  }

  const run = await prisma.adpRefreshRun.create({
    data: {
      status: 'running',
      trigger,
      startedAt,
      sportsProcessed: sportsProcessed,
    },
  })

  try {
    const importerResult = await runAdpImporter({ sports: sportsProcessed })
    const finishedAt = new Date()
    const durationMs = finishedAt.getTime() - startedAt.getTime()
    const quality = await buildQualitySummary(importerResult.season, importerResult.week, sportsProcessed)
    const rawProviderRowsSkippedAsDuplicates = importerResult.providerRowsRead - importerResult.providerRowsWritten
    const status = quality.missingSports.length > 0 || quality.duplicateGroups > 0 ? 'partial' : 'success'

    await prisma.adpRefreshRun.update({
      where: { id: run.id },
      data: {
        status,
        finishedAt,
        durationMs,
        rawRowsRead: importerResult.providerRowsRead,
        rawRowsInserted: importerResult.providerRowsWritten,
        rawRowsSkipped: rawProviderRowsSkippedAsDuplicates,
        consensusRowsWritten: importerResult.consensusRowsWritten,
        providerCountSummary: {
          distribution: quality.providerCountDistribution,
          singleSourcePercentage: quality.singleSourcePercentage,
        } as object,
        qualitySummary: {
          missingSports: quality.missingSports,
          staleSegmentsOlderThan24h: quality.staleSegmentsOlderThan24h,
          duplicateGroups: quality.duplicateGroups,
          topWarnings: quality.topWarnings,
          consensusRowsBySport: importerResult.consensusRowsBySport,
        } as object,
      },
    })

    return {
      runId: run.id,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs,
      trigger,
      sportsProcessed,
      season: importerResult.season,
      week: importerResult.week,
      rawProviderRowsRead: importerResult.providerRowsRead,
      rawProviderRowsInserted: importerResult.providerRowsWritten,
      rawProviderRowsSkippedAsDuplicates,
      consensusRowsInsertedOrUpdated: importerResult.consensusRowsWritten,
      consensusRowsBySport: importerResult.consensusRowsBySport,
      providerCountDistribution: quality.providerCountDistribution,
      singleSourcePercentage: quality.singleSourcePercentage,
      missingSports: quality.missingSports,
      staleSegmentsOlderThan24h: quality.staleSegmentsOlderThan24h,
      duplicateGroups: quality.duplicateGroups,
      warnings: quality.topWarnings,
      errors,
    }
  } catch (error) {
    const finishedAt = new Date()
    const durationMs = finishedAt.getTime() - startedAt.getTime()
    const message = error instanceof Error ? error.message : String(error)
    errors.push(message)
    await prisma.adpRefreshRun.update({
      where: { id: run.id },
      data: {
        status: 'failed',
        finishedAt,
        durationMs,
        errorMessage: message,
      },
    })
    throw error
  }
}