/**
 * Mock draft session: create, get, start, reset, complete. Invite token flow.
 */

import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import type { MockDraftStatus, MockSlotConfigEntry, MockDraftSettings } from './types'
import { normalizeMockDraftTeamCount } from '@/lib/mock-draft/mockTeamCount'

const DEFAULT_SETTINGS: MockDraftSettings = {
  sport: 'NFL',
  leagueType: 'redraft',
  draftType: 'snake',
  numTeams: 12,
  rounds: 15,
  timerSeconds: 60,
  aiEnabled: true,
  scoringFormat: 'default',
  poolType: 'all',
  roomMode: 'solo',
  humanTeams: 1,
  keepersEnabled: false,
  keepers: [],
}

function parseMetadata(metadata: unknown): MockDraftSettings {
  const values = (metadata || {}) as Record<string, unknown>
  return {
    sport: normalizeToSupportedSport(String(values.sport ?? DEFAULT_SETTINGS.sport)),
    leagueType: String(values.leagueType ?? DEFAULT_SETTINGS.leagueType),
    draftType: String(values.draftType ?? DEFAULT_SETTINGS.draftType),
    // Any size a league of this sport and type accepts (lib/mock-draft/mockTeamCount.ts).
    numTeams: normalizeMockDraftTeamCount(values.numTeams, values.sport, values.leagueType),
    rounds: Math.min(22, Math.max(1, Number(values.rounds) ?? DEFAULT_SETTINGS.rounds)),
    timerSeconds: Number(values.timerSeconds) ?? DEFAULT_SETTINGS.timerSeconds,
    aiEnabled: Boolean(values.aiEnabled ?? DEFAULT_SETTINGS.aiEnabled),
    scoringFormat: String(values.scoringFormat ?? DEFAULT_SETTINGS.scoringFormat),
    leagueId: (values.leagueId as string) ?? undefined,
    rosterSize: values.rosterSize != null ? Number(values.rosterSize) : undefined,
    poolType: String(values.poolType ?? DEFAULT_SETTINGS.poolType),
    roomMode: String(values.roomMode ?? DEFAULT_SETTINGS.roomMode) as any,
    humanTeams: Math.min(
      normalizeMockDraftTeamCount(values.numTeams, values.sport, values.leagueType),
      Math.max(1, Number(values.humanTeams) || 1)
    ),
    keepersEnabled: Boolean(values.keepersEnabled ?? false),
    keepers: Array.isArray(values.keepers) ? (values.keepers as any[]) : [],
  }
}

function defaultSlotConfig(numTeams: number): MockSlotConfigEntry[] {
  return Array.from({ length: numTeams }, (_, index) => ({
    slot: index + 1,
    type: index === 0 ? 'human' as const : 'cpu' as const,
    displayName: index === 0 ? 'You' : `CPU ${index + 1}`,
  }))
}

function parseSlotConfig(slotConfig: unknown): MockSlotConfigEntry[] {
  return Array.isArray(slotConfig) ? (slotConfig as MockSlotConfigEntry[]) : []
}

function attachOwnerToSlotConfig(
  userId: string,
  slotConfig: MockSlotConfigEntry[],
  displayName = 'You'
): MockSlotConfigEntry[] {
  if (slotConfig.some((slot) => slot.userId === userId)) return slotConfig

  const firstEmptyHumanIndex = slotConfig.findIndex((slot) => slot.type === 'human' && !slot.userId)
  if (firstEmptyHumanIndex === -1) return slotConfig

  const updated = [...slotConfig]
  updated[firstEmptyHumanIndex] = {
    ...updated[firstEmptyHumanIndex],
    userId,
    displayName: updated[firstEmptyHumanIndex]?.displayName || displayName,
  }
  return updated
}

function isDraftParticipant(draft: { userId: string; slotConfig: unknown }, userId?: string | null): boolean {
  if (!userId) return false
  if (draft.userId === userId) return true
  return parseSlotConfig(draft.slotConfig).some((slot) => slot.userId === userId)
}

function toSnapshot(
  draft: {
    id: string
    status: string
    inviteToken: string | null
    shareId: string | null
    metadata: unknown
    slotConfig: unknown
    results: unknown
    rounds: number
    createdAt: Date
    updatedAt: Date
    userId: string
  },
  viewerUserId?: string
) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || ''
  const canManage = viewerUserId != null && draft.userId === viewerUserId

  return {
    id: draft.id,
    status: draft.status as MockDraftStatus,
    inviteToken: canManage ? draft.inviteToken : null,
    inviteLink: canManage && draft.inviteToken ? `${baseUrl}/mock-draft/join?token=${draft.inviteToken}` : null,
    shareId: draft.shareId,
    settings: parseMetadata(draft.metadata),
    slotConfig: parseSlotConfig(draft.slotConfig),
    results: (draft.results as unknown[]) ?? [],
    rounds: draft.rounds,
    createdAt: draft.createdAt.toISOString(),
    updatedAt: draft.updatedAt.toISOString(),
    canManage,
  }
}

export async function createMockDraftSession(userId: string, options?: {
  leagueId?: string | null
  settings?: Partial<MockDraftSettings>
  slotConfig?: MockSlotConfigEntry[]
}) {
  const settings: MockDraftSettings = { ...DEFAULT_SETTINGS, ...options?.settings }
  const slotConfig = attachOwnerToSlotConfig(userId, options?.slotConfig ?? defaultSlotConfig(settings.numTeams))
  const inviteToken = crypto.randomBytes(12).toString('base64url')
  const metadata = {
    ...settings,
    source: 'mock-draft-engine',
  }

  const draft = await prisma.mockDraft.create({
    data: {
      userId,
      leagueId: options?.leagueId ?? undefined,
      rounds: settings.rounds,
      results: [],
      proposals: [],
      status: 'pre_draft',
      inviteToken,
      slotConfig: slotConfig as any,
      metadata: metadata as any,
    },
  })

  return toSnapshot(draft, userId)
}

export async function getMockDraftById(draftId: string, userId?: string) {
  const draft = await prisma.mockDraft.findUnique({
    where: { id: draftId },
  })
  if (!draft) return null
  if (userId && !isDraftParticipant(draft, userId)) return null
  if (!userId) return toSnapshot(draft)
  return toSnapshot(draft, userId)
}

export async function canAccessMockDraft(draftId: string, userId: string): Promise<boolean> {
  const draft = await prisma.mockDraft.findUnique({
    where: { id: draftId },
    select: { userId: true, slotConfig: true },
  })
  if (!draft) return false
  return isDraftParticipant(draft, userId)
}

export async function getMockDraftByInviteToken(token: string) {
  const draft = await prisma.mockDraft.findUnique({
    where: { inviteToken: token },
  })
  if (!draft) return null
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || ''
  return {
    id: draft.id,
    status: draft.status as MockDraftStatus,
    inviteToken: draft.inviteToken,
    inviteLink: draft.inviteToken ? `${baseUrl}/mock-draft/join?token=${draft.inviteToken}` : null,
    shareId: draft.shareId,
    settings: parseMetadata(draft.metadata),
    slotConfig: parseSlotConfig(draft.slotConfig),
    results: (draft.results as unknown[]) ?? [],
    rounds: draft.rounds,
    createdAt: draft.createdAt.toISOString(),
    updatedAt: draft.updatedAt.toISOString(),
  }
}

export async function startMockDraft(draftId: string, userId: string): Promise<boolean> {
  const draft = await prisma.mockDraft.findFirst({
    where: { id: draftId, userId },
  })
  if (!draft || draft.status !== 'pre_draft') return false
  await prisma.mockDraft.update({
    where: { id: draftId },
    data: { status: 'in_progress', updatedAt: new Date() },
  })
  return true
}

export async function resetMockDraft(draftId: string, userId: string): Promise<boolean> {
  const draft = await prisma.mockDraft.findFirst({
    where: { id: draftId, userId },
  })
  if (!draft) return false
  await prisma.mockDraft.update({
    where: { id: draftId },
    data: {
      status: 'pre_draft',
      results: [],
      proposals: [],
      updatedAt: new Date(),
    },
  })
  return true
}

export async function completeMockDraft(draftId: string, userId: string, results: unknown[]): Promise<boolean> {
  const draft = await prisma.mockDraft.findFirst({
    where: { id: draftId, userId },
  })
  if (!draft) return false
  await prisma.mockDraft.update({
    where: { id: draftId },
    data: {
      status: 'completed',
      results: results as any,
      updatedAt: new Date(),
    },
  })
  return true
}

export async function joinMockDraftByToken(
  token: string,
  userId: string,
  displayName?: string
): Promise<{ draftId: string; joined: boolean } | null> {
  const draft = await prisma.mockDraft.findUnique({
    where: { inviteToken: token },
  })
  if (!draft || draft.status !== 'pre_draft') return null

  const slotConfig = parseSlotConfig(draft.slotConfig)
  if (slotConfig.some((slot) => slot.userId === userId)) {
    return { draftId: draft.id, joined: true }
  }

  const firstEmptyHumanIndex = slotConfig.findIndex((slot) => slot.type === 'human' && !slot.userId)
  if (firstEmptyHumanIndex === -1) {
    return { draftId: draft.id, joined: false }
  }

  const updated = [...slotConfig]
  updated[firstEmptyHumanIndex] = {
    ...updated[firstEmptyHumanIndex],
    userId,
    displayName: displayName ?? updated[firstEmptyHumanIndex]?.displayName ?? `User ${firstEmptyHumanIndex + 1}`,
  }

  await prisma.mockDraft.update({
    where: { id: draft.id },
    data: { slotConfig: updated as any, updatedAt: new Date() },
  })
  return { draftId: draft.id, joined: true }
}
