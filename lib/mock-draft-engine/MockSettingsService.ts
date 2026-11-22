/**
 * Mock draft settings: get/update from metadata. Only editable when status = pre_draft.
 */

import { prisma } from '@/lib/prisma'
import type { MockDraftSettings, MockSlotConfigEntry } from './types'
import { normalizeMockDraftTeamCount } from '@/lib/mock-draft/mockTeamCount'

export async function getMockDraftSettings(draftId: string, userId?: string): Promise<MockDraftSettings | null> {
  const draft = await prisma.mockDraft.findFirst({
    where: userId ? { id: draftId, userId } : { id: draftId },
    select: { metadata: true },
  })
  if (!draft?.metadata) return null
  const m = draft.metadata as Record<string, unknown>
  return {
    sport: String(m.sport ?? 'NFL'),
    leagueType: String(m.leagueType ?? 'redraft'),
    draftType: String(m.draftType ?? 'snake'),
    numTeams: normalizeMockDraftTeamCount(m.numTeams, m.sport, m.leagueType),
    rounds: Math.min(22, Math.max(1, Number(m.rounds) ?? 15)),
    timerSeconds: Number(m.timerSeconds) ?? 60,
    aiEnabled: Boolean(m.aiEnabled ?? true),
    scoringFormat: String(m.scoringFormat ?? 'default'),
    leagueId: (m.leagueId as string) ?? undefined,
    rosterSize: m.rosterSize != null ? Number(m.rosterSize) : undefined,
    poolType: String(m.poolType ?? 'all'),
    roomMode: String(m.roomMode ?? 'solo') as any,
    humanTeams: m.humanTeams != null ? Number(m.humanTeams) : 1,
    keepersEnabled: Boolean(m.keepersEnabled ?? false),
    keepers: Array.isArray(m.keepers) ? (m.keepers as any[]) : [],
  }
}

export async function updateMockDraftSettings(
  draftId: string,
  userId: string,
  partial: Partial<MockDraftSettings> & { slotConfig?: MockSlotConfigEntry[] }
): Promise<boolean> {
  const draft = await prisma.mockDraft.findFirst({
    where: { id: draftId, userId },
    select: { status: true, metadata: true, slotConfig: true },
  })
  if (!draft || draft.status !== 'pre_draft') return false
  const current = (draft.metadata || {}) as Record<string, unknown>
  const nextMeta = {
    ...current,
    ...(partial.sport != null && { sport: partial.sport }),
    ...(partial.leagueType != null && { leagueType: partial.leagueType }),
    ...(partial.draftType != null && { draftType: partial.draftType }),
    ...(partial.numTeams != null && { numTeams: partial.numTeams }),
    ...(partial.rounds != null && { rounds: partial.rounds }),
    ...(partial.timerSeconds != null && { timerSeconds: partial.timerSeconds }),
    ...(partial.aiEnabled != null && { aiEnabled: partial.aiEnabled }),
    ...(partial.scoringFormat != null && { scoringFormat: partial.scoringFormat }),
    ...(partial.leagueId !== undefined && { leagueId: partial.leagueId }),
    ...(partial.rosterSize != null && { rosterSize: partial.rosterSize }),
    ...(partial.poolType != null && { poolType: partial.poolType }),
    ...(partial.roomMode != null && { roomMode: partial.roomMode }),
    ...(partial.humanTeams != null && { humanTeams: partial.humanTeams }),
    ...(partial.keepersEnabled != null && { keepersEnabled: partial.keepersEnabled }),
    ...(partial.keepers != null && { keepers: partial.keepers }),
  }
  // Store a size a league of this sport and type accepts, so what is saved is what every reader sees.
  if (nextMeta.numTeams != null) nextMeta.numTeams = normalizeMockDraftTeamCount(nextMeta.numTeams, nextMeta.sport, nextMeta.leagueType)
  await prisma.mockDraft.update({
    where: { id: draftId },
    data: {
      metadata: nextMeta as any,
      ...(partial.slotConfig && { slotConfig: partial.slotConfig as any }),
      updatedAt: new Date(),
    },
  })
  return true
}
