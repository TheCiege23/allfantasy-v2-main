import { prisma } from '@/lib/prisma'
import { getLiveADP } from '@/lib/adp-data'
import { loadSportAwareDraftPlayerPool } from '@/lib/mock-draft/sport-player-pool'
import { makeAIPick } from '@/lib/mock-draft-simulator/DraftAIManager'
import type { DraftPlayer } from '@/lib/mock-draft-simulator/types'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import type {
  MockDraftPickSnapshot,
  MockDraftProgressSnapshot,
  MockDraftSessionSnapshot,
  MockDraftSettings,
  MockDraftSummarySnapshot,
  MockRoomMode,
  MockSlotConfigEntry,
} from './types'

type MockDraftRow = {
  id: string
  status: string
  userId: string
  inviteToken: string | null
  shareId: string | null
  metadata: unknown
  slotConfig: unknown
  results: unknown
  rounds: number
  createdAt: Date
  updatedAt: Date
}

const CPU_LOOP_LIMIT = 250

function parseSettings(metadata: unknown): MockDraftSettings {
  const raw = (metadata || {}) as Record<string, unknown>
  const numTeams = Math.min(16, Math.max(8, Number(raw.numTeams) || 12))
  const roomModeRaw = String(raw.roomMode ?? 'solo')
  const roomMode: MockRoomMode =
    roomModeRaw === 'cpu_only' || roomModeRaw === 'mixed' || roomModeRaw === 'linked_public'
      ? roomModeRaw
      : 'solo'
  return {
    sport: normalizeToSupportedSport(String(raw.sport ?? 'NFL')),
    leagueType: String(raw.leagueType ?? 'redraft'),
    draftType: String(raw.draftType ?? 'snake'),
    numTeams,
    rounds: Math.min(25, Math.max(1, Number(raw.rounds) || 15)),
    timerSeconds: Math.max(0, Number(raw.timerSeconds) || 0),
    aiEnabled: Boolean(raw.aiEnabled ?? true),
    scoringFormat: String(raw.scoringFormat ?? 'default'),
    leagueId: (raw.leagueId as string) ?? undefined,
    rosterSize: raw.rosterSize != null ? Math.max(8, Number(raw.rosterSize)) : undefined,
    poolType: String(raw.poolType ?? 'all'),
    roomMode,
    humanTeams: Math.min(numTeams, Math.max(1, Number(raw.humanTeams) || 1)),
    keepersEnabled: Boolean(raw.keepersEnabled ?? false),
    keepers: Array.isArray(raw.keepers) ? (raw.keepers as any[]) : [],
  }
}

function defaultSlotConfig(settings: MockDraftSettings, ownerUserId: string): MockSlotConfigEntry[] {
  const numTeams = settings.numTeams
  const roomMode = settings.roomMode ?? 'solo'
  if (roomMode === 'cpu_only') {
    return Array.from({ length: numTeams }, (_, index) => ({
      slot: index + 1,
      type: 'cpu',
      userId: null,
      displayName: `CPU ${index + 1}`,
    }))
  }
  if (roomMode === 'linked_public') {
    return Array.from({ length: numTeams }, (_, index) => ({
      slot: index + 1,
      type: 'human',
      userId: index === 0 ? ownerUserId : null,
      displayName: index === 0 ? 'Host' : `Open Slot ${index + 1}`,
    }))
  }
  if (roomMode === 'mixed') {
    const humanTeams = Math.min(numTeams, Math.max(1, settings.humanTeams || 1))
    return Array.from({ length: numTeams }, (_, index) => {
      const slot = index + 1
      if (slot <= humanTeams) {
        return {
          slot,
          type: 'human',
          userId: slot === 1 ? ownerUserId : null,
          displayName: slot === 1 ? 'Host' : `Open Slot ${slot}`,
        }
      }
      return {
        slot,
        type: 'cpu',
        userId: null,
        displayName: `CPU ${slot}`,
      }
    })
  }
  return Array.from({ length: numTeams }, (_, index) => ({
    slot: index + 1,
    type: index === 0 ? 'human' : 'cpu',
    userId: index === 0 ? ownerUserId : null,
    displayName: index === 0 ? 'Host' : `CPU ${index + 1}`,
  }))
}

function parseSlotConfig(
  slotConfig: unknown,
  settings: MockDraftSettings,
  ownerUserId: string
): MockSlotConfigEntry[] {
  const base = defaultSlotConfig(settings, ownerUserId)
  if (!Array.isArray(slotConfig)) return base
  const provided = new Map<number, MockSlotConfigEntry>()
  for (const entry of slotConfig) {
    const record = entry as Record<string, unknown>
    const slot = Number(record.slot)
    if (!Number.isFinite(slot)) continue
    provided.set(slot, {
      slot,
      type: record.type === 'human' ? 'human' : 'cpu',
      userId: record.userId != null ? String(record.userId) : null,
      displayName: record.displayName != null ? String(record.displayName) : null,
    })
  }
  return base.map((slot) => {
    const override = provided.get(slot.slot)
    if (!override) return slot
    return {
      ...slot,
      type: override.type,
      userId: override.userId ?? null,
      displayName: override.displayName ?? slot.displayName,
    }
  })
}

function parseResults(results: unknown): MockDraftPickSnapshot[] {
  if (!Array.isArray(results)) return []
  return results
    .map((entry) => entry as Record<string, unknown>)
    .filter((entry) => Number.isFinite(Number(entry.overall)))
    .map((entry) => ({
      round: Number(entry.round) || 1,
      pick: Number(entry.pick) || 1,
      overall: Number(entry.overall),
      slot: Number(entry.slot) || Number(entry.pick) || 1,
      manager: String(entry.manager ?? ''),
      playerName: String(entry.playerName ?? ''),
      position: String(entry.position ?? '').toUpperCase(),
      team: entry.team != null ? String(entry.team) : null,
      playerId: entry.playerId != null ? String(entry.playerId) : null,
      isUser: Boolean(entry.isUser),
      isBotPick: Boolean(entry.isBotPick),
      source: (entry.source as MockDraftPickSnapshot['source']) ?? 'cpu',
      createdAt: entry.createdAt != null ? String(entry.createdAt) : undefined,
    }))
}

function isParticipant(draft: MockDraftRow, userId?: string): boolean {
  if (!userId) return false
  if (draft.userId === userId) return true
  if (!Array.isArray(draft.slotConfig)) return false
  return draft.slotConfig.some((slot: any) => slot?.userId === userId)
}

function getSlotForOverall(overall: number, numTeams: number, draftType: string): number {
  const round = Math.floor((overall - 1) / numTeams) + 1
  const pickInRound = ((overall - 1) % numTeams) + 1
  if (draftType === 'linear' || draftType === 'auction') return pickInRound
  return round % 2 === 1 ? pickInRound : numTeams - pickInRound + 1
}

function getRoundForOverall(overall: number, numTeams: number): number {
  return Math.floor((overall - 1) / numTeams) + 1
}

function getPickInRound(overall: number, numTeams: number): number {
  return ((overall - 1) % numTeams) + 1
}

function getProgress(
  settings: MockDraftSettings,
  slotConfig: MockSlotConfigEntry[],
  results: MockDraftPickSnapshot[],
  status: string,
  metadata: unknown,
  viewerUserId?: string
): MockDraftProgressSnapshot {
  const totalPicks = settings.numTeams * settings.rounds
  const completedPicks = Math.min(results.length, totalPicks)
  if (completedPicks >= totalPicks || status === 'completed') {
    return {
      totalPicks,
      completedPicks,
      currentOverall: null,
      currentRound: null,
      currentSlot: null,
      currentManager: null,
      currentSlotType: null,
      isViewerOnClock: false,
      timerEndsAt: null,
      remainingSeconds: null,
    }
  }
  const currentOverall = completedPicks + 1
  const currentSlot = getSlotForOverall(currentOverall, settings.numTeams, settings.draftType)
  const currentRound = getRoundForOverall(currentOverall, settings.numTeams)
  const slot = slotConfig.find((entry) => entry.slot === currentSlot)
  const slotType = slot?.type === 'cpu' || !slot?.userId ? 'cpu' : 'human'
  const values = (metadata || {}) as Record<string, unknown>
  const startedAtRaw = values.currentPickStartedAt ? String(values.currentPickStartedAt) : null
  const startedAt = startedAtRaw ? new Date(startedAtRaw) : null
  const validStart = startedAt && !Number.isNaN(startedAt.getTime()) ? startedAt : null
  const timerEndsAt =
    status === 'in_progress' && validStart && settings.timerSeconds > 0
      ? new Date(validStart.getTime() + settings.timerSeconds * 1000)
      : null
  return {
    totalPicks,
    completedPicks,
    currentOverall,
    currentRound,
    currentSlot,
    currentManager: slot?.displayName || (slotType === 'cpu' ? `CPU ${currentSlot}` : `Manager ${currentSlot}`),
    currentSlotType: slotType,
    isViewerOnClock: Boolean(viewerUserId && slot?.userId === viewerUserId),
    timerEndsAt: timerEndsAt ? timerEndsAt.toISOString() : null,
    remainingSeconds: timerEndsAt ? Math.max(0, Math.ceil((timerEndsAt.getTime() - Date.now()) / 1000)) : null,
  }
}

function getSummary(
  draft: MockDraftRow,
  slotConfig: MockSlotConfigEntry[],
  results: MockDraftPickSnapshot[],
  settings: MockDraftSettings
): MockDraftSummarySnapshot | null {
  if (results.length === 0) return null
  return {
    draftId: draft.id,
    status: draft.status as any,
    totalPicks: settings.numTeams * settings.rounds,
    completedPicks: results.length,
    topPicks: results.slice(0, 32),
    picksByManager: slotConfig
      .map((slot) => {
        const managerPicks = results.filter((pick) => pick.slot === slot.slot)
        const positions: Record<string, number> = {}
        for (const pick of managerPicks) {
          positions[pick.position] = (positions[pick.position] || 0) + 1
        }
        return {
          manager: slot.displayName || `Slot ${slot.slot}`,
          slot: slot.slot,
          totalPicks: managerPicks.length,
          positions,
        }
      })
      .sort((a, b) => a.slot - b.slot),
  }
}

function toSnapshot(draft: MockDraftRow, viewerUserId?: string): MockDraftSessionSnapshot {
  const settings = parseSettings(draft.metadata)
  const slotConfig = parseSlotConfig(draft.slotConfig, settings, draft.userId)
  const results = parseResults(draft.results)
  const progress = getProgress(settings, slotConfig, results, draft.status, draft.metadata, viewerUserId)
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || ''
  const canManage = Boolean(viewerUserId && viewerUserId === draft.userId)
  return {
    id: draft.id,
    status: draft.status as any,
    inviteToken: canManage ? draft.inviteToken : null,
    inviteLink: canManage && draft.inviteToken ? `${baseUrl}/mock-draft/join?token=${draft.inviteToken}` : null,
    shareId: draft.shareId,
    settings,
    slotConfig,
    results,
    progress,
    summary: draft.status === 'completed' ? getSummary(draft, slotConfig, results, settings) : null,
    chatScope: 'mock-only',
    rounds: draft.rounds,
    createdAt: draft.createdAt.toISOString(),
    updatedAt: draft.updatedAt.toISOString(),
    canManage,
  }
}

function playerKey(playerName: string, position: string) {
  return `${playerName.trim().toLowerCase()}|${position.trim().toUpperCase()}`
}

export async function loadMockDraftPlayerPool(settings: MockDraftSettings): Promise<DraftPlayer[]> {
  const target = settings.numTeams * settings.rounds + 120
  const sport = normalizeToSupportedSport(settings.sport)
  // The legacy live ADP feed is NFL-only. NCAAF must always resolve through
  // the sport-aware pool so pro players can never leak into a college draft.
  if (sport === 'NFL') {
    const adp = await getLiveADP(settings.leagueType === 'dynasty' ? 'dynasty' : 'redraft', target).catch(() => [])
    if (adp.length > 0) {
      return adp.map((row) => ({
        name: row.name,
        position: row.position,
        team: row.team ?? null,
        adp: row.adp ?? null,
        value: row.value ?? null,
        playerId: row.ffcPlayerId != null ? String(row.ffcPlayerId) : null,
      }))
    }
  }
  return loadSportAwareDraftPlayerPool({
    sport,
    leagueId: settings.leagueId ?? null,
    limit: target,
  })
}

async function chooseCpuPlayer(
  settings: MockDraftSettings,
  results: MockDraftPickSnapshot[],
  slot: number,
  manager: string,
  overall: number
): Promise<DraftPlayer> {
  const pool = await loadMockDraftPlayerPool(settings)
  const drafted = new Set(results.map((pick) => playerKey(pick.playerName, pick.position)))
  const available = pool.filter((player) => !drafted.has(playerKey(player.name, player.position)))
  if (available.length === 0) {
    return {
      name: `CPU Prospect ${overall}`,
      position: ['QB', 'RB', 'WR', 'TE'][(overall - 1) % 4] || 'WR',
      team: null,
      adp: overall,
      value: 50,
      playerId: null,
    }
  }
  const rosterSoFar = results.filter((pick) => pick.slot === slot).map((pick) => ({ position: pick.position }))
  const choice =
    (await makeAIPick({
      sport: settings.sport,
      managerName: manager,
      rosterSoFar,
      availablePlayers: available,
      round: getRoundForOverall(overall, settings.numTeams),
      overall,
      slot,
      numTeams: settings.numTeams,
      draftType: settings.draftType === 'linear' ? 'linear' : 'snake',
      useMeta: settings.aiEnabled !== false,
    })) ?? available[0]
  return choice
}

async function autoAdvanceCpu(draftId: string): Promise<void> {
  for (let i = 0; i < CPU_LOOP_LIMIT; i += 1) {
    const draft = (await prisma.mockDraft.findUnique({ where: { id: draftId } })) as MockDraftRow | null
    if (!draft || draft.status !== 'in_progress') return
    const settings = parseSettings(draft.metadata)
    const slotConfig = parseSlotConfig(draft.slotConfig, settings, draft.userId)
    const results = parseResults(draft.results)
    const progress = getProgress(settings, slotConfig, results, draft.status, draft.metadata)
    if (!progress.currentOverall || !progress.currentSlot) {
      await prisma.mockDraft.update({
        where: { id: draftId },
        data: {
          status: 'completed',
          updatedAt: new Date(),
          metadata: {
            ...((draft.metadata || {}) as Record<string, unknown>),
            completedAt: new Date().toISOString(),
          } as any,
        },
      })
      return
    }
    const slot = slotConfig.find((entry) => entry.slot === progress.currentSlot)
    const effectiveCpu = slot?.type === 'cpu' || !slot?.userId
    if (!effectiveCpu) return
    const manager = slot?.displayName || `CPU ${progress.currentSlot}`
    const cpu = await chooseCpuPlayer(settings, results, progress.currentSlot, manager, progress.currentOverall)
    const nextResults = [
      ...results,
      {
        round: getRoundForOverall(progress.currentOverall, settings.numTeams),
        pick: getPickInRound(progress.currentOverall, settings.numTeams),
        overall: progress.currentOverall,
        slot: progress.currentSlot,
        manager,
        playerName: cpu.name,
        position: String(cpu.position || 'WR').toUpperCase(),
        team: cpu.team ?? null,
        playerId: cpu.playerId ?? null,
        isUser: Boolean(slot?.userId),
        isBotPick: true,
        source: 'cpu' as const,
        createdAt: new Date().toISOString(),
      },
    ]
    const total = settings.numTeams * settings.rounds
    const nextStatus = nextResults.length >= total ? 'completed' : 'in_progress'
    const updated = await prisma.mockDraft.updateMany({
      where: { id: draftId, updatedAt: draft.updatedAt },
      data: {
        results: nextResults as any,
        status: nextStatus,
        updatedAt: new Date(),
        metadata: {
          ...((draft.metadata || {}) as Record<string, unknown>),
          currentPickStartedAt: new Date().toISOString(),
          ...(nextStatus === 'completed' ? { completedAt: new Date().toISOString() } : {}),
        } as any,
      },
    })
    if (updated.count === 0) continue
    if (nextStatus === 'completed') return
  }
}

async function maybeExpireTimer(draftId: string): Promise<void> {
  const draft = (await prisma.mockDraft.findUnique({ where: { id: draftId } })) as MockDraftRow | null
  if (!draft || draft.status !== 'in_progress') return
  const settings = parseSettings(draft.metadata)
  if (settings.timerSeconds <= 0) return
  const slotConfig = parseSlotConfig(draft.slotConfig, settings, draft.userId)
  const results = parseResults(draft.results)
  const progress = getProgress(settings, slotConfig, results, draft.status, draft.metadata)
  if (!progress.currentOverall || !progress.currentSlot || progress.currentSlotType !== 'human') return
  if (progress.remainingSeconds == null || progress.remainingSeconds > 0) return

  const slot = slotConfig.find((entry) => entry.slot === progress.currentSlot)
  const manager = slot?.displayName || `Manager ${progress.currentSlot}`
  const cpu = await chooseCpuPlayer(settings, results, progress.currentSlot, manager, progress.currentOverall)
  const nextResults = [
    ...results,
    {
      round: getRoundForOverall(progress.currentOverall, settings.numTeams),
      pick: getPickInRound(progress.currentOverall, settings.numTeams),
      overall: progress.currentOverall,
      slot: progress.currentSlot,
      manager,
      playerName: cpu.name,
      position: String(cpu.position || 'WR').toUpperCase(),
      team: cpu.team ?? null,
      playerId: cpu.playerId ?? null,
      isUser: Boolean(slot?.userId),
      isBotPick: true,
      source: 'autopick' as const,
      createdAt: new Date().toISOString(),
    },
  ]
  const total = settings.numTeams * settings.rounds
  const nextStatus = nextResults.length >= total ? 'completed' : 'in_progress'
  await prisma.mockDraft.updateMany({
    where: { id: draft.id, updatedAt: draft.updatedAt },
    data: {
      results: nextResults as any,
      status: nextStatus,
      updatedAt: new Date(),
      metadata: {
        ...((draft.metadata || {}) as Record<string, unknown>),
        currentPickStartedAt: new Date().toISOString(),
        ...(nextStatus === 'completed' ? { completedAt: new Date().toISOString() } : {}),
      } as any,
    },
  })
  if (nextStatus !== 'completed') await autoAdvanceCpu(draftId)
}

export async function getMockDraftRuntimeSnapshot(
  draftId: string,
  viewerUserId: string
): Promise<MockDraftSessionSnapshot | null> {
  await maybeExpireTimer(draftId)
  await autoAdvanceCpu(draftId)
  const draft = (await prisma.mockDraft.findUnique({ where: { id: draftId } })) as MockDraftRow | null
  if (!draft) return null
  if (!isParticipant(draft, viewerUserId)) return null
  return toSnapshot(draft, viewerUserId)
}

export async function startMockDraftRuntime(
  draftId: string,
  userId: string
): Promise<MockDraftSessionSnapshot | null> {
  const draft = (await prisma.mockDraft.findFirst({ where: { id: draftId, userId } })) as MockDraftRow | null
  if (!draft || draft.status !== 'pre_draft') return null
  await prisma.mockDraft.update({
    where: { id: draftId },
    data: {
      status: 'in_progress',
      updatedAt: new Date(),
      metadata: {
        ...((draft.metadata || {}) as Record<string, unknown>),
        currentPickStartedAt: new Date().toISOString(),
      } as any,
    },
  })
  await autoAdvanceCpu(draftId)
  return getMockDraftRuntimeSnapshot(draftId, userId)
}

export async function submitMockDraftPickRuntime(
  draftId: string,
  userId: string,
  input: { playerName: string; position: string; team?: string | null; playerId?: string | null }
): Promise<{ ok: boolean; error?: string; draft?: MockDraftSessionSnapshot }> {
  await maybeExpireTimer(draftId)
  const draft = (await prisma.mockDraft.findUnique({ where: { id: draftId } })) as MockDraftRow | null
  if (!draft) return { ok: false, error: 'Draft not found' }
  if (!isParticipant(draft, userId)) return { ok: false, error: 'Forbidden' }
  if (draft.status !== 'in_progress') return { ok: false, error: 'Draft is not in progress' }

  const settings = parseSettings(draft.metadata)
  const slotConfig = parseSlotConfig(draft.slotConfig, settings, draft.userId)
  const results = parseResults(draft.results)
  const progress = getProgress(settings, slotConfig, results, draft.status, draft.metadata, userId)
  if (!progress.currentOverall || !progress.currentSlot) return { ok: false, error: 'Draft is complete' }
  const slot = slotConfig.find((entry) => entry.slot === progress.currentSlot)
  if (!slot || slot.type !== 'human' || !slot.userId) return { ok: false, error: 'CPU pick in progress' }
  if (slot.userId !== userId) return { ok: false, error: 'Not your turn' }

  const playerName = String(input.playerName || '').trim()
  const position = String(input.position || '').trim().toUpperCase()
  if (!playerName || !position) return { ok: false, error: 'playerName and position required' }
  const duplicate = results.some((pick) => playerKey(pick.playerName, pick.position) === playerKey(playerName, position))
  if (duplicate) return { ok: false, error: 'Player already drafted' }

  const nextResults = [
    ...results,
    {
      round: getRoundForOverall(progress.currentOverall, settings.numTeams),
      pick: getPickInRound(progress.currentOverall, settings.numTeams),
      overall: progress.currentOverall,
      slot: progress.currentSlot,
      manager: slot.displayName || `Manager ${progress.currentSlot}`,
      playerName,
      position,
      team: input.team ?? null,
      playerId: input.playerId ?? null,
      isUser: true,
      isBotPick: false,
      source: 'human' as const,
      createdAt: new Date().toISOString(),
    },
  ]
  const total = settings.numTeams * settings.rounds
  const nextStatus = nextResults.length >= total ? 'completed' : 'in_progress'
  const updated = await prisma.mockDraft.updateMany({
    where: { id: draft.id, updatedAt: draft.updatedAt },
    data: {
      results: nextResults as any,
      status: nextStatus,
      updatedAt: new Date(),
      metadata: {
        ...((draft.metadata || {}) as Record<string, unknown>),
        currentPickStartedAt: new Date().toISOString(),
        ...(nextStatus === 'completed' ? { completedAt: new Date().toISOString() } : {}),
      } as any,
    },
  })
  if (updated.count === 0) return { ok: false, error: 'Draft state changed, retry' }
  if (nextStatus !== 'completed') await autoAdvanceCpu(draftId)
  const snapshot = await getMockDraftRuntimeSnapshot(draftId, userId)
  return { ok: Boolean(snapshot), draft: snapshot ?? undefined, error: snapshot ? undefined : 'Draft not found' }
}

export async function getMockDraftEvents(
  draftId: string,
  userId: string,
  since?: string | null
): Promise<{ changed: boolean; draft: MockDraftSessionSnapshot | null; serverTime: string }> {
  const snapshot = await getMockDraftRuntimeSnapshot(draftId, userId)
  if (!snapshot) return { changed: false, draft: null, serverTime: new Date().toISOString() }
  const sinceMs = since ? new Date(since).getTime() : 0
  const updatedMs = new Date(snapshot.updatedAt).getTime()
  const changed = !since || Number.isNaN(sinceMs) || updatedMs > sinceMs
  return {
    changed,
    draft: changed ? snapshot : null,
    serverTime: new Date().toISOString(),
  }
}

export async function getMockDraftCompletionSummary(
  draftId: string,
  userId: string
): Promise<MockDraftSummarySnapshot | null> {
  const snapshot = await getMockDraftRuntimeSnapshot(draftId, userId)
  if (!snapshot) return null
  if (snapshot.summary) return snapshot.summary
  return getSummary(
    {
      id: snapshot.id,
      status: snapshot.status,
      userId,
      inviteToken: snapshot.inviteToken,
      shareId: snapshot.shareId,
      metadata: snapshot.settings,
      slotConfig: snapshot.slotConfig,
      results: snapshot.results,
      rounds: snapshot.rounds,
      createdAt: new Date(snapshot.createdAt),
      updatedAt: new Date(snapshot.updatedAt),
    },
    snapshot.slotConfig,
    snapshot.results,
    snapshot.settings
  )
}

