/**
 * Aggregated API payload for GET /api/leagues/[leagueId]/dispersal-draft/[draftId]
 */

import { prisma } from '@/lib/prisma'

import { DispersalDraftEngine } from './DispersalDraftEngine'
import type { DispersalDraftState } from './types'

const dispersalDraftClient = prisma.dispersalDraft

export type DispersalDraftDetailApi = {
  draft: Record<string, unknown>
  picks: unknown[]
  participants: unknown[]
  assetPool: unknown[]
  state: DispersalDraftState
  currentPicker: { userId: string | null; displayName: string | null; timeRemainingSeconds: number | null }
  isComplete: boolean
}

function serializeDraftRow(row: {
  id: string
  leagueId: string
  scenario: string
  status: string
  participantRosterIds: string[]
  passedRosterIds: string[]
  draftOrder: string[]
  currentPickIndex: number
  totalRounds: number
  picksPerRound: number
  sourceRosterIds: string[]
  assetPool: unknown
  orderMode: string
  draftType: string
  pickTimeSeconds: number
  autoPickOnTimeout: boolean
  createdByUserId: string
  startedAt: Date | null
  completedAt: Date | null
  createdAt: Date
  updatedAt: Date
}): Record<string, unknown> {
  return {
    id: row.id,
    leagueId: row.leagueId,
    scenario: row.scenario,
    status: row.status,
    participantRosterIds: row.participantRosterIds,
    passedRosterIds: row.passedRosterIds,
    draftOrder: row.draftOrder,
    currentPickIndex: row.currentPickIndex,
    totalRounds: row.totalRounds,
    picksPerRound: row.picksPerRound,
    sourceRosterIds: row.sourceRosterIds,
    assetPool: row.assetPool,
    orderMode: row.orderMode,
    draftType: row.draftType,
    pickTimeSeconds: row.pickTimeSeconds,
    autoPickOnTimeout: row.autoPickOnTimeout,
    createdByUserId: row.createdByUserId,
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function getDispersalDraftDetail(
  leagueId: string,
  draftId: string
): Promise<DispersalDraftDetailApi | null> {
  const row = await dispersalDraftClient.findFirst({
    where: { id: draftId, leagueId },
    include: {
      picks: { orderBy: { pickNumber: 'asc' } },
      participants: { orderBy: { draftSlot: 'asc' } },
      assetPoolRows: { orderBy: { createdAt: 'asc' } },
    },
  })
  if (!row) return null

  const state = await DispersalDraftEngine.getDraftState(draftId)
  if (!state) return null

  const currentRosterId = state.currentRosterId
  let userId: string | null = null
  let displayName: string | null = null
  if (currentRosterId) {
    const team = await prisma.leagueTeam.findFirst({
      where: { leagueId, externalId: currentRosterId },
      select: { claimedByUserId: true, ownerName: true, teamName: true },
    })
    userId = team?.claimedByUserId ?? null
    displayName = team?.teamName?.trim() || team?.ownerName?.trim() || null
    if (userId) {
      const u = await prisma.appUser.findUnique({
        where: { id: userId },
        select: { username: true, displayName: true },
      })
      if (u?.displayName?.trim()) displayName = u.displayName.trim()
      else if (u?.username?.trim()) displayName = u.username.trim()
    }
  }

  const availablePool = row.assetPoolRows.filter((r: { isAvailable?: boolean }) => r.isAvailable)

  const { picks, participants, assetPoolRows, ...draftBase } = row

  return {
    draft: serializeDraftRow(draftBase),
    picks: row.picks,
    participants: row.participants,
    assetPool: availablePool,
    state,
    currentPicker: {
      userId,
      displayName,
      timeRemainingSeconds: state.pickTimeSeconds > 0 && state.status === 'in_progress' ? state.pickTimeSeconds : null,
    },
    isComplete: state.isComplete,
  }
}
