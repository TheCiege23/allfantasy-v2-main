import * as prismaJson from '@/lib/prisma-json'
import { prisma } from '@/lib/prisma'
import type { ReputationRuntimeConfig, ReputationScoreWeights, ReputationSport, ReputationTier } from './types'
import { normalizeSportForReputation } from './SportReputationResolver'
import { REPUTATION_TIERS } from './types'
import { DEFAULT_REPUTATION_SCORE_WEIGHTS, normalizeScoreWeights } from './ReputationScoreCalculator'
import { type TierThresholdsConfig, normalizeTierThresholdConfig } from './ReputationTierResolver'

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function parseTierThresholds(value: unknown): TierThresholdsConfig {
  const obj = asObject(value)
  const out: TierThresholdsConfig = {}
  for (const tier of REPUTATION_TIERS) {
    const row = asObject(obj[tier])
    const min = row.min
    const max = row.max
    if (typeof min !== 'number' || !Number.isFinite(min)) continue
    out[tier] = {
      min,
      ...(typeof max === 'number' && Number.isFinite(max) ? { max } : {}),
    }
  }
  return out
}

function parseScoreWeights(value: unknown): Partial<ReputationScoreWeights> {
  const obj = asObject(value)
  const out: Partial<ReputationScoreWeights> = {}
  for (const key of Object.keys(DEFAULT_REPUTATION_SCORE_WEIGHTS) as Array<keyof ReputationScoreWeights>) {
    const current = obj[key]
    if (typeof current === 'number' && Number.isFinite(current)) {
      out[key] = current
    }
  }
  return out
}

export async function getReputationRuntimeConfig(input: {
  leagueId: string
  sport?: string | null
  season?: number | null
}): Promise<ReputationRuntimeConfig> {
  const league = await prisma.league.findUnique({
    where: { id: input.leagueId },
    select: { sport: true, season: true },
  })
  if (!league) throw new Error('League not found')
  const sport = normalizeSportForReputation(input.sport ?? league.sport ?? null) as ReputationSport
  const season = input.season ?? league.season ?? new Date().getUTCFullYear()

  const record = await prisma.reputationConfigRecord.findUnique({
    where: {
      reputation_config_records_scope_unique: { leagueId: input.leagueId, sport, season },
    },
  })
  if (record) {
    return {
      sport,
      season,
      tierThresholds: normalizeTierThresholdConfig(parseTierThresholds(record.tierThresholds)),
      scoreWeights: normalizeScoreWeights(parseScoreWeights(record.scoreWeights)),
    }
  }

  const settings = asObject((await prisma.league.findUnique({
    where: { id: input.leagueId },
    select: { settings: true },
  }))?.settings)
  const settingsThresholds = parseTierThresholds(settings.reputationTierThresholds)
  const settingsWeights = parseScoreWeights(settings.reputationScoreWeights)

  return {
    sport,
    season,
    tierThresholds: normalizeTierThresholdConfig(settingsThresholds),
    scoreWeights: normalizeScoreWeights(settingsWeights),
  }
}

export async function upsertReputationRuntimeConfig(input: {
  leagueId: string
  sport?: string | null
  season?: number | null
  tierThresholds?: TierThresholdsConfig | null
  scoreWeights?: Partial<ReputationScoreWeights> | null
}): Promise<ReputationRuntimeConfig> {
  const current = await getReputationRuntimeConfig({
    leagueId: input.leagueId,
    sport: input.sport ?? null,
    season: input.season ?? null,
  })
  const tierThresholds = normalizeTierThresholdConfig(input.tierThresholds ?? current.tierThresholds)
  const scoreWeights = normalizeScoreWeights(input.scoreWeights ?? current.scoreWeights)
  await prisma.reputationConfigRecord.upsert({
    where: {
      reputation_config_records_scope_unique: {
        leagueId: input.leagueId,
        sport: current.sport,
        season: current.season,
      },
    },
    create: {
      leagueId: input.leagueId,
      sport: current.sport,
      season: current.season,
      tierThresholds,
      scoreWeights: prismaJson.toPrismaJsonInput(scoreWeights),
    },
    update: {
      tierThresholds,
      scoreWeights: prismaJson.toPrismaJsonInput(scoreWeights),
    },
  })
  return {
    sport: current.sport,
    season: current.season,
    tierThresholds,
    scoreWeights,
  }
}
