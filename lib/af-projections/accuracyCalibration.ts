import 'server-only'

import { prisma } from '@/lib/prisma'
import type { ProjectionCalibrationMap } from './types'
import type { ProjectionAccuracyRecord } from '@/lib/projections/projectionAccuracy'
import { PROJECTION_ACCURACY_CACHE_PREFIX } from '@/lib/projections/projectionAccuracy'
import { deriveProjectionCalibration } from './calibrationMath'

const MAX_WEEKS = 6
/**
 * Builds bounded corrections from completed weeks only. Positive historical bias means AF
 * projected too high, so the next correction is negative. Small samples are withheld and all
 * accepted samples are shrunk toward zero before the ±2.5 point safety cap.
 */
export async function loadProjectionCalibrationMap(
  season: number,
  targetWeek: number,
): Promise<ProjectionCalibrationMap> {
  if (targetWeek <= 1) return {}
  const rows = await prisma.sportsDataCache.findMany({
    where: { cacheKey: { startsWith: `${PROJECTION_ACCURACY_CACHE_PREFIX}${season}:` } },
    select: { data: true },
  }).catch(() => [])
  const records = rows
    .map((row) => row.data as unknown as ProjectionAccuracyRecord)
    .filter((record) => record?.version === 1 && record.week < targetWeek)
    .sort((a, b) => b.week - a.week)
    .slice(0, MAX_WEEKS)
  return deriveProjectionCalibration(records)
}
