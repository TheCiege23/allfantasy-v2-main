import 'server-only'

import { prisma } from '@/lib/prisma'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import type { AllFantasyLearningLayersPayload, AfLearningSnapshotRow } from '@/lib/ai-learning-system/types'

const SAFETY_REMINDER =
  'Learned app/league/user behavior is advisory only. Never contradict official injury status, lineup locks, slot eligibility, or league scoring rules.'

function rowFromDb(
  snap: {
    features: unknown
    explain: unknown | null
    confidence: number
    sampleSize: number
    windowDays: number
    updatedAt: Date
    computedAt: Date
  } | null,
): AfLearningSnapshotRow | null {
  if (!snap) return null
  return {
    features: snap.features,
    explain: snap.explain,
    confidence: snap.confidence,
    sampleSize: snap.sampleSize,
    windowDays: snap.windowDays,
    updatedAt: snap.updatedAt,
    computedAt: snap.computedAt,
  }
}

type ResolveLearningLayersArgs = {
  userId: string
  sport: string
  leagueId?: string | null
}

/**
 * Loads persisted learning snapshots for the standard AI payload.
 * When snapshots are missing, returns structured nulls (prompts can say "insufficient learning history").
 */
export async function resolveLearningLayersForPayload(
  args: ResolveLearningLayersArgs,
): Promise<AllFantasyLearningLayersPayload> {
  if (process.env.AF_LEARNING_PAYLOAD_ENABLED === 'false') {
    return {
      schemaVersion: 1,
      sport: normalizeToSupportedSport(args.sport),
      leagueId: args.leagueId?.trim() ?? null,
      userId: args.userId,
      appLearningState: { loaded: false, snapshot: null },
      leagueLearningState: { loaded: false, leagueId: args.leagueId?.trim() ?? null, snapshot: null },
      userLearningState: { loaded: false, snapshot: null },
      safetyReminder: SAFETY_REMINDER,
    }
  }

  const sport = normalizeToSupportedSport(args.sport)
  const leagueId = args.leagueId?.trim() ?? null

  const [appSnap, leagueSnap, userSnap] = await Promise.all([
    prisma.afAppLearningSnapshot.findUnique({ where: { sport } }),
    leagueId
      ? prisma.afLeagueLearningSnapshot.findUnique({ where: { leagueId } })
      : Promise.resolve(null),
    prisma.afUserLearningProfile.findUnique({ where: { userId: args.userId } }),
  ])

  return {
    schemaVersion: 1,
    sport,
    leagueId,
    userId: args.userId,
    appLearningState: { loaded: true, snapshot: rowFromDb(appSnap) },
    leagueLearningState: {
      loaded: true,
      leagueId,
      snapshot: leagueId ? rowFromDb(leagueSnap) : null,
    },
    userLearningState: { loaded: true, snapshot: rowFromDb(userSnap) },
    safetyReminder: SAFETY_REMINDER,
  }
}
