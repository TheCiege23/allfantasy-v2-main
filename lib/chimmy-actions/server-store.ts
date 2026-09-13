import { prisma } from '@/lib/prisma'
import type { AIActionEvent, AIActionType, SavedAIRecommendation } from './AIActionModel'
import {
  buildLearningSnapshotFromEvents,
  getDefaultOutcomeAdapters,
  type ChimmyLearningSnapshot,
} from './AIActionAnalytics'

type EventRow = {
  id: string
  action_type: AIActionType
  surface: string
  user_id: string
  league_id: string | null
  team_id: string | null
  sport: string | null
  event: 'shown' | 'clicked' | 'confirmed' | 'staged' | 'completed' | 'dismissed' | 'saved' | 'failed'
  timestamp: string
  duration_ms: number | null
  metadata: Record<string, unknown> | null
}

export async function createActionEvent(event: AIActionEvent): Promise<void> {
  await (prisma as any).aiActionEvent.create({
    data: {
      id: event.id,
      actionType: event.actionType,
      surface: event.surface,
      userId: event.userId,
      leagueId: event.leagueId ?? null,
      teamId: event.teamId ?? null,
      sport: event.sport ?? null,
      event: event.event,
      timestamp: new Date(event.timestamp),
      durationMs: event.durationMs ?? null,
      metadata: (event.metadata ?? null) as any,
    },
  })
}

export async function listActionEvents(userId: string, limit: number): Promise<EventRow[]> {
  const rows = await (prisma as any).aiActionEvent.findMany({
    where: { userId },
    orderBy: { timestamp: 'desc' },
    take: limit,
  })

  return rows.map((row: any) => ({
    id: String(row.id),
    action_type: row.actionType as AIActionType,
    surface: String(row.surface),
    user_id: String(row.userId),
    league_id: row.leagueId ? String(row.leagueId) : null,
    team_id: row.teamId ? String(row.teamId) : null,
    sport: row.sport ? String(row.sport) : null,
    event: row.event,
    timestamp: new Date(row.timestamp).toISOString(),
    duration_ms: typeof row.durationMs === 'number' ? row.durationMs : null,
    metadata: row.metadata ? (row.metadata as Record<string, unknown>) : null,
  }))
}

export async function createSavedRecommendation(rec: SavedAIRecommendation): Promise<string> {
  const created = await (prisma as any).aiSavedRecommendation.create({
    data: {
      id: rec.id,
      userId: rec.userId,
      leagueId: rec.leagueId ?? null,
      sport: rec.sport,
      leagueType: rec.leagueType,
      surface: rec.surface,
      recommendationText: rec.recommendationText,
      action: rec.action as any,
      savedAt: new Date(rec.savedAt),
      expiresAt: rec.expiresAt ? new Date(rec.expiresAt) : null,
      actedOn: rec.actedOn ?? false,
      actedOnAt: rec.actedOnAt ? new Date(rec.actedOnAt) : null,
    },
  })

  return String(created.id)
}

export async function getSavedRecommendationById(
  id: string,
  userId?: string
): Promise<SavedAIRecommendation | null> {
  const row = await (prisma as any).aiSavedRecommendation.findFirst({
    where: {
      id,
      ...(userId ? { userId } : {}),
    },
  })

  if (!row) return null
  return mapRowToRecommendation(row)
}

export async function listSavedRecommendations(
  userId: string,
  limit: number
): Promise<SavedAIRecommendation[]> {
  const rows = await (prisma as any).aiSavedRecommendation.findMany({
    where: { userId },
    orderBy: { savedAt: 'desc' },
    take: limit,
  })

  return rows.map(mapRowToRecommendation)
}

export async function markSavedRecommendationActedOn(id: string, userId?: string): Promise<void> {
  await (prisma as any).aiSavedRecommendation.updateMany({
    where: {
      id,
      ...(userId ? { userId } : {}),
    },
    data: {
      actedOn: true,
      actedOnAt: new Date(),
    },
  })
}

export async function getChimmyLearningSnapshotServer(
  userId: string,
  options?: {
    limit?: number
    includeSavedRecommendations?: boolean
  }
): Promise<ChimmyLearningSnapshot> {
  const limit = options?.limit ?? 1000
  const events = await listActionEvents(userId, limit)
  const snapshot = buildLearningSnapshotFromEvents(events, {
    outcomeAdapters: getDefaultOutcomeAdapters(),
  })

  if (options?.includeSavedRecommendations) {
    const saved = await listSavedRecommendations(userId, 200)
    if (saved.length > 0) {
      snapshot.notes.push(`Saved recommendations in history: ${saved.length}.`)
    }
  }

  return snapshot
}

function mapRowToRecommendation(row: any): SavedAIRecommendation {
  return {
    id: String(row.id),
    userId: String(row.userId),
    leagueId: row.leagueId ? String(row.leagueId) : null,
    sport: String(row.sport),
    leagueType: String(row.leagueType),
    surface: String(row.surface),
    recommendationText: String(row.recommendationText),
    action: row.action,
    savedAt: new Date(row.savedAt).getTime(),
    expiresAt: row.expiresAt ? new Date(row.expiresAt).getTime() : null,
    actedOn: Boolean(row.actedOn),
    actedOnAt: row.actedOnAt ? new Date(row.actedOnAt).getTime() : null,
  }
}
