import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { resolveLeagueClass, type LeagueClass } from './adaptive-weight-learning'
import type { CompositeWeightProfile } from './composite-weights'
import { getCompositeWeightConfig, resolveWeightProfile, computeCompositeFromWeights } from './composite-weights'

export interface LearnedCompositeParams {
  injuryInfluence: number
  starterBenchSplit: number
  luckDampening: number
  futureCapitalInfluence: number
}

const DEFAULT_PARAMS: Record<string, LearnedCompositeParams> = {
  DYN_SF: { injuryInfluence: 0.30, starterBenchSplit: 0.70, luckDampening: 2.0, futureCapitalInfluence: 0.10 },
  DYN_1QB: { injuryInfluence: 0.30, starterBenchSplit: 0.70, luckDampening: 2.0, futureCapitalInfluence: 0.10 },
  RED_SF: { injuryInfluence: 0.30, starterBenchSplit: 0.80, luckDampening: 2.0, futureCapitalInfluence: 0.00 },
  RED_1QB: { injuryInfluence: 0.30, starterBenchSplit: 0.80, luckDampening: 2.0, futureCapitalInfluence: 0.00 },
  SPC: { injuryInfluence: 0.25, starterBenchSplit: 0.75, luckDampening: 2.0, futureCapitalInfluence: 0.05 },
  UNK: { injuryInfluence: 0.30, starterBenchSplit: 0.75, luckDampening: 2.0, futureCapitalInfluence: 0.05 },
}

function getDefaultCompositeParams(segmentKey: string): LearnedCompositeParams {
  const key = segmentKey.replace(/_inseason|_offseason|_postDraft|_postSeason/, '')
  return DEFAULT_PARAMS[key] ?? DEFAULT_PARAMS.UNK
}

export async function getActiveCompositeParams(segmentKey: string): Promise<LearnedCompositeParams> {
  const baseKey = segmentKey.replace(/_inseason|_offseason|_postDraft|_postSeason/, '')

  try {
    const row = await prisma.rankingWeightsWeekly.findFirst({
      where: {
        segmentKey: { startsWith: baseKey },
        status: 'APPLIED',
        compositeParamsJson: { not: Prisma.JsonNull },
      },
      orderBy: { weekStart: 'desc' },
    })

    if (row?.compositeParamsJson) {
      const params = row.compositeParamsJson as Record<string, number>
      return {
        injuryInfluence: params.injuryInfluence ?? DEFAULT_PARAMS[baseKey]?.injuryInfluence ?? 0.30,
        starterBenchSplit: params.starterBenchSplit ?? DEFAULT_PARAMS[baseKey]?.starterBenchSplit ?? 0.75,
        luckDampening: params.luckDampening ?? DEFAULT_PARAMS[baseKey]?.luckDampening ?? 2.0,
        futureCapitalInfluence: params.futureCapitalInfluence ?? DEFAULT_PARAMS[baseKey]?.futureCapitalInfluence ?? 0.05,
      }
    }
  } catch {}

  return getDefaultCompositeParams(segmentKey)
}

