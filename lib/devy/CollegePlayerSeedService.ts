import 'server-only'

import { prisma } from '@/lib/prisma'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { normalizePlayerName, normalizePosition } from '@/lib/team-abbrev'
import { apiChain } from '@/lib/workers/api-chain'
import { ingestCFBDRosters, ingestCFBDStats } from '@/lib/devy-classification'

type SupportedCollegeSeedSport = 'NCAAF' | 'NCAAB'

export type CollegePlayerSeedResult = {
  sport: SupportedCollegeSeedSport
  source: string
  seeded: number
  updated: number
  totalInPool: number
  errors: string[]
  /** Rows the provider chain returned (NCAAB only). 0 means the chain answered nothing usable. */
  fetched?: number
  /**
   * NCAAB only: the row offset to resume from when `deadlineAt` stopped the run between batches,
   * or `null` when every row from `startAt` on was written.
   */
  nextOffset?: number | null
}

/**
 * Bounds for the NCAAB seed, used by its scheduled writer (`lib/devy/ingestNcaabDevyPool.ts`).
 * Both optional: without them the seed writes every row in one pass, as it always has.
 */
export type CollegePlayerSeedOptions = {
  /** Epoch ms. Checked BETWEEN batches of 100 — a batch is one transaction and is never cut. */
  deadlineAt?: number
  /** Skip this many rows of the provider payload (resume a run a deadline stopped). */
  startAt?: number
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

function toNullableInt(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.round(parsed) : null
}

function normalizeSchool(value: unknown): string {
  return String(value ?? '').trim() || 'Unknown School'
}

async function seedCollegeFootballPlayers(): Promise<CollegePlayerSeedResult> {
  const roster = await ingestCFBDRosters()
  const stats = await ingestCFBDStats(roster.rosterYear)
  const totalInPool = await prisma.devyPlayer.count({
    where: { ncaaSourceTag: 'ncaaf_cfbd' },
  })

  return {
    sport: 'NCAAF',
    source: 'cfbd',
    seeded: roster.ingested,
    updated: stats.updated,
    totalInPool,
    errors: [...roster.errors, ...stats.errors],
  }
}

async function seedCollegeBasketballPlayers(options: CollegePlayerSeedOptions = {}): Promise<CollegePlayerSeedResult> {
  const response = await apiChain.fetch<Array<Record<string, unknown>>>({
    sport: 'NCAAB',
    dataType: 'players',
  })

  const source = response.source
  const rows = Array.isArray(response.data) ? response.data : []
  const now = new Date()
  let seeded = 0
  const errors: string[] = []
  const startAt = Math.max(0, Math.floor(options.startAt ?? 0))
  let offset = startAt
  let nextOffset: number | null = null

  for (const batch of chunk(rows.slice(startAt), 100)) {
    if (options.deadlineAt != null && Date.now() >= options.deadlineAt) {
      nextOffset = offset
      break
    }
    offset += batch.length
    const validRows = batch.flatMap((row) => {
      const name = String(row.name ?? row.fullName ?? row.displayName ?? '').trim()
      const position = normalizePosition(String(row.position ?? row.pos ?? '')) ?? 'G'
      const school = normalizeSchool(row.team ?? row.school ?? row.college)
      const normalizedName = normalizePlayerName(name)

      if (!name || !normalizedName) {
        errors.push(`Skipped player with missing name in ${source} payload`)
        return []
      }

      return [{ row, name, position, school, normalizedName }]
    })

    seeded += validRows.length
    await prisma.$transaction(
      validRows.map(({ row, name, position, school, normalizedName }) =>
        prisma.devyPlayer.upsert({
          where: {
            uniq_devy_player: {
              normalizedName,
              position,
              school,
            },
          },
          create: {
            name,
            normalizedName,
            position,
            school,
            sport: 'NCAAB',
            headshotUrl: typeof row.headshotUrl === 'string' ? row.headshotUrl : typeof row.image === 'string' ? row.image : null,
            jerseyNumber: typeof row.jerseyNumber === 'string' ? row.jerseyNumber : null,
            classYear: null,
            classYearLabel: null,
            heightInches: toNullableInt(row.heightInches ?? row.height),
            weightLbs: toNullableInt(row.weightLbs ?? row.weight),
            league: 'NCAA',
            devyEligible: true,
            graduatedToNFL: false,
            draftStatus: 'college',
            statusSource: source,
            statusConfidence: 70,
            statusUpdatedAt: now,
            source,
            ncaaSourceTag: `ncaab_${source}`,
            lastSyncedAt: now,
          },
          update: {
            sport: 'NCAAB',
            headshotUrl: typeof row.headshotUrl === 'string' ? row.headshotUrl : typeof row.image === 'string' ? row.image : undefined,
            jerseyNumber: typeof row.jerseyNumber === 'string' ? row.jerseyNumber : undefined,
            heightInches: toNullableInt(row.heightInches ?? row.height),
            weightLbs: toNullableInt(row.weightLbs ?? row.weight),
            statusSource: source,
            statusUpdatedAt: now,
            source,
            ncaaSourceTag: `ncaab_${source}`,
            lastSyncedAt: now,
          },
        })
      )
    )
  }

  const totalInPool = await prisma.devyPlayer.count({
    where: { ncaaSourceTag: `ncaab_${source}` },
  })

  return {
    sport: 'NCAAB',
    source,
    seeded,
    updated: 0,
    totalInPool,
    errors,
    fetched: rows.length,
    nextOffset,
  }
}

export async function seedCollegePlayers(
  input: { sport: string } & CollegePlayerSeedOptions,
): Promise<CollegePlayerSeedResult> {
  const sport = normalizeToSupportedSport(input.sport)

  if (sport === 'NCAAF') {
    return seedCollegeFootballPlayers()
  }

  if (sport === 'NCAAB') {
    return seedCollegeBasketballPlayers({ deadlineAt: input.deadlineAt, startAt: input.startAt })
  }

  throw new Error('College player seed only supports NCAAF and NCAAB.')
}
