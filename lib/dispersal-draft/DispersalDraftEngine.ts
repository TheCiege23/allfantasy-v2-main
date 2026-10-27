/**
 * Dispersal draft state machine (configure → in progress → complete).
 * Server-only: uses Prisma + crypto.
 */

import { randomBytes } from 'node:crypto'

import { Prisma } from '@prisma/client'

import { getLeagueRole } from '@/lib/league/permissions'
import { prisma } from '@/lib/prisma'
import { isOrphanPlatformUserId } from '@/lib/orphan-ai-manager/orphanRosterResolver'

import { buildAssetPoolFromRosters } from './assetPoolBuilder'
import type { DispersalAsset, DispersalDraftConfig, DispersalDraftState } from './types'

/**
 * The dispersal draft's own delegates. These were `any` while the models were missing from
 * prisma/schema.prisma — which hid that the generated client had no `dispersalDraft` at all, so every
 * call threw. They are the real delegates now, so typecheck covers every call below.
 */
type DispersalModelClient = Pick<
  Prisma.TransactionClient,
  'dispersalAssetPool' | 'dispersalDraft' | 'dispersalDraftParticipant' | 'dispersalDraftPick' | 'dispersalDraftRoster'
>

/** Transaction client for nested writes in dispersal draft seeding. */
type DispersalTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0] & DispersalModelClient

const dispersalPrisma = prisma as typeof prisma & DispersalModelClient

function withDispersalModels<T extends object>(client: T): T & DispersalModelClient {
  return client as T & DispersalModelClient
}

function assetDisplayNameForPool(a: DispersalAsset): string {
  if (a.assetType === 'player') return a.playerName ?? a.playerId ?? 'Player'
  if (a.assetType === 'draft_pick') return a.pickLabel ?? 'Draft pick'
  if (a.assetType === 'faab') return `FAAB $${a.faabAmount ?? 0}`
  return 'Asset'
}

async function seedDispersalDraftSecondaryTables(
  tx: DispersalTx,
  draft: { id: string; leagueId: string },
  assets: DispersalAsset[],
  participantRosterIds: string[],
  commissionerUserId: string
): Promise<void> {
  if (assets.length > 0) {
    await tx.dispersalAssetPool.createMany({
      data: assets.map((a) => ({
        draftId: draft.id,
        leagueId: draft.leagueId,
        playerId: a.id,
        playerName: assetDisplayNameForPool(a),
        playerPosition: a.playerPosition ?? null,
        playerTeam: a.playerTeam ?? null,
        sourceRosterId: a.sourceRosterId,
        isAvailable: a.isAvailable,
        metadata: {
          assetType: a.assetType,
          pickId: a.pickId,
          faabAmount: a.faabAmount,
        } as Prisma.InputJsonValue,
      })),
    })
  }

  let slot = 0
  for (const rosterId of participantRosterIds) {
    const team = await tx.leagueTeam.findFirst({
      where: { leagueId: draft.leagueId, externalId: rosterId },
      select: {
        id: true,
        teamName: true,
        claimedByUserId: true,
        isCommissioner: true,
      },
    })
    const userId = team?.claimedByUserId?.trim() || `unclaimed-${rosterId}`
    await tx.dispersalDraftParticipant.create({
      data: {
        draftId: draft.id,
        leagueId: draft.leagueId,
        userId,
        displayName: null,
        teamName: team?.teamName ?? null,
        draftSlot: slot++,
        isCommissioner: userId === commissionerUserId || Boolean(team?.isCommissioner),
      },
    })
    await tx.dispersalDraftRoster.create({
      data: {
        draftId: draft.id,
        leagueId: draft.leagueId,
        userId,
        teamId: team?.id ?? null,
        players: [],
      },
    })
  }
}

async function syncParticipantOnClockFlags(
  tx: DispersalTx | typeof prisma,
  draftId: string,
  leagueId: string,
  pickIndex: number
): Promise<void> {
  const dispersalClient = withDispersalModels(tx)

  await dispersalClient.dispersalDraftParticipant.updateMany({
    where: { draftId },
    data: { isOnTheClock: false },
  })
  const row = await dispersalClient.dispersalDraft.findUnique({
    where: { id: draftId },
    select: { draftOrder: true, passedRosterIds: true, currentPickIndex: true },
  })
  if (!row) return
  const rosterId = getCurrentRosterId(row.draftOrder, pickIndex, row.passedRosterIds)
  if (!rosterId) return
  const team = await dispersalClient.leagueTeam.findFirst({
    where: { leagueId, externalId: rosterId },
    select: { claimedByUserId: true },
  })
  const uid = team?.claimedByUserId?.trim()
  if (!uid) return
  await dispersalClient.dispersalDraftParticipant.updateMany({
    where: { draftId, userId: uid },
    data: { isOnTheClock: true },
  })
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor((randomBytes(4).readUInt32BE(0) / 0x1_0000_0000) * (i + 1))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}

function parseAssetPool(raw: unknown): DispersalAsset[] {
  if (!Array.isArray(raw)) return []
  return raw as DispersalAsset[]
}

function buildLinearDraftOrder(baseOrder: string[], rounds: number): string[] {
  const out: string[] = []
  for (let r = 0; r < rounds; r++) {
    for (const id of baseOrder) out.push(id)
  }
  return out
}

/** Rounds from spec: countable = players + draft picks (exclude FAAB from divisor); ensure enough slots for FAAB too. */
function computeRoundsPicksPerRound(
  assets: DispersalAsset[],
  participantCount: number
): { totalRounds: number; picksPerRound: number } {
  const n = Math.max(1, participantCount)
  const countable = assets.filter((a) => a.assetType !== 'faab').length
  let totalRounds = Math.max(1, Math.ceil(countable / n))
  while (totalRounds * n < assets.length) {
    totalRounds += 1
  }
  return { totalRounds, picksPerRound: n }
}

async function rowToState(row: {
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
  assetPool: unknown
  sourceRosterIds: string[]
  pickTimeSeconds: number
  autoPickOnTimeout: boolean
  startedAt: Date | null
  completedAt: Date | null
  picks: {
    pickNumber: number
    round: number
    pickInRound: number
    rosterId: string
    assetType: string | null
    assetId: string | null
    assetDisplayName: string | null
    isPassed: boolean
    pickedAt: Date | null
    isAutoPick?: boolean
  }[]
}): Promise<DispersalDraftState> {
  const assetPool = parseAssetPool(row.assetPool)
  const draftOrder = row.draftOrder
  const currentRosterId = getCurrentRosterId(draftOrder, row.currentPickIndex, row.passedRosterIds)
  const isComplete = row.status === 'completed' || row.status === 'cancelled'
  const lastPick = row.picks[row.picks.length - 1]
  const currentPickNumber = lastPick ? lastPick.pickNumber + 1 : 1

  return {
    id: row.id,
    leagueId: row.leagueId,
    scenario: row.scenario as DispersalDraftState['scenario'],
    status: row.status as DispersalDraftState['status'],
    participantRosterIds: row.participantRosterIds,
    passedRosterIds: row.passedRosterIds,
    draftOrder: row.draftOrder,
    currentPickIndex: row.currentPickIndex,
    totalRounds: row.totalRounds,
    picksPerRound: row.picksPerRound,
    assetPool,
    sourceRosterIds: row.sourceRosterIds,
    picks: row.picks.map((p) => ({
      pickNumber: p.pickNumber,
      round: p.round,
      pickInRound: p.pickInRound,
      rosterId: p.rosterId,
      assetType: p.assetType ?? undefined,
      assetId: p.assetId ?? undefined,
      assetDisplayName: p.assetDisplayName ?? undefined,
      isPassed: p.isPassed,
      pickedAt: p.pickedAt?.toISOString(),
      isAutoPick: p.isAutoPick === true,
    })),
    currentRosterId,
    currentPickNumber,
    isComplete,
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    pickTimeSeconds: row.pickTimeSeconds,
    autoPickOnTimeout: row.autoPickOnTimeout,
  }
}

function getCurrentRosterId(
  draftOrder: string[],
  startIndex: number,
  passedRosterIds: string[]
): string | null {
  const passed = new Set(passedRosterIds)
  let i = startIndex
  while (i < draftOrder.length) {
    const rid = draftOrder[i]!
    if (!passed.has(rid)) return rid
    i++
  }
  return null
}

function advanceToNextSlot(
  draftOrder: string[],
  startIndex: number,
  passedRosterIds: string[]
): number {
  const passed = new Set(passedRosterIds)
  let i = startIndex + 1
  while (i < draftOrder.length) {
    if (!passed.has(draftOrder[i]!)) return i
    i++
  }
  return i
}

function allAssetsClaimed(assets: DispersalAsset[]): boolean {
  if (assets.length === 0) return true
  return assets.every((a) => !a.isAvailable)
}

function allParticipantsPassed(participantRosterIds: string[], passedRosterIds: string[]): boolean {
  if (participantRosterIds.length === 0) return false
  const passed = new Set(passedRosterIds)
  return participantRosterIds.every((id) => passed.has(id))
}

function asJsonRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function nextRoundReentryPickIndex(
  draftOrder: string[],
  picksPerRound: number,
  rosterId: string,
  currentPickIndex: number
): number | null {
  const p = Math.max(1, picksPerRound)
  const curRound = Math.floor(Math.max(0, currentPickIndex) / p)
  let best: number | null = null
  for (let i = 0; i < draftOrder.length; i++) {
    if (draftOrder[i] !== rosterId) continue
    const rr = Math.floor(i / p)
    if (rr > curRound) {
      if (best === null || i < best) best = i
    }
  }
  return best
}

function readPlayerDataRoot(playerData: unknown): Record<string, unknown> {
  if (playerData == null) return { players: [] as unknown[] }
  if (Array.isArray(playerData)) return { players: [...playerData] }
  const r = asJsonRecord(playerData)
  return r && Object.keys(r).length > 0 ? { ...r } : { players: [] as unknown[] }
}

function draftPickMatchesAsset(raw: unknown, pickId: string): boolean {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null
  if (!o) return false
  const id =
    (typeof o.id === 'string' && o.id) ||
    (typeof o.pick_id === 'string' && o.pick_id) ||
    (typeof o.pickId === 'string' && o.pickId) ||
    (typeof o.draft_pick_id === 'string' && o.draft_pick_id) ||
    ''
  return id === pickId
}

export class DispersalDraftEngine {
  static async createDraft(
    config: DispersalDraftConfig,
    commissionerUserId: string
  ): Promise<DispersalDraftState> {
    const { assets } = await buildAssetPoolFromRosters(config.leagueId, config.sourceRosterIds)
    if (assets.length === 0) {
      throw new Error('No assets in pool — orphan rosters must include players, draft picks, or FAAB.')
    }
    const participants = [...new Set(config.participantRosterIds)]
    if (participants.length === 0) {
      throw new Error('Dispersal draft requires at least one participant roster')
    }
    if (participants.length < 2) {
      throw new Error('Dispersal draft requires at least two participating teams')
    }

    let baseOrder: string[] = []
    if (config.orderMode === 'commissioner_set') {
      const manual = config.manualOrder?.filter((id) => participants.includes(id)) ?? []
      baseOrder = manual.length > 0 ? manual : participants
      for (const p of participants) {
        if (!baseOrder.includes(p)) baseOrder.push(p)
      }
    } else {
      baseOrder = shuffle(participants)
    }

    const { totalRounds, picksPerRound } = computeRoundsPicksPerRound(assets, baseOrder.length)
    const draftOrder = buildLinearDraftOrder(baseOrder, totalRounds)
    const draftTypeStored =
      typeof config.draftType === 'string' && config.draftType.trim()
        ? config.draftType.trim().slice(0, 16)
        : 'linear'

    const created = await prisma.$transaction(async (rawTx) => {
      const tx = withDispersalModels(rawTx)
      const draft = await tx.dispersalDraft.create({
        data: {
          leagueId: config.leagueId,
          scenario: config.scenario,
          status: 'configuring',
          participantRosterIds: participants,
          passedRosterIds: [],
          draftOrder,
          currentPickIndex: 0,
          totalRounds,
          picksPerRound,
          sourceRosterIds: config.sourceRosterIds,
          assetPool: JSON.parse(JSON.stringify(assets)) as Prisma.InputJsonValue,
          orderMode: config.orderMode,
          draftType: draftTypeStored,
          pickTimeSeconds: config.pickTimeSeconds,
          autoPickOnTimeout: config.autoPickOnTimeout,
          createdByUserId: commissionerUserId,
        },
        include: { picks: { orderBy: { pickNumber: 'asc' } } },
      })
      await seedDispersalDraftSecondaryTables(tx, draft, assets, participants, commissionerUserId)
      return draft
    })

    return rowToState(created)
  }

  static async startDraft(draftId: string, commissionerUserId: string): Promise<DispersalDraftState> {
    const row = await dispersalPrisma.dispersalDraft.findFirst({
      where: { id: draftId },
      include: { picks: { orderBy: { pickNumber: 'asc' } } },
    })
    if (!row) throw new Error('Draft not found')
    const role = await getLeagueRole(row.leagueId, commissionerUserId)
    const canStart =
      role === 'commissioner' ||
      role === 'co_commissioner' ||
      row.createdByUserId === commissionerUserId
    if (!canStart) {
      throw new Error('Only a league commissioner can start this draft')
    }
    if (row.status !== 'configuring') throw new Error('Draft is not in configuring status')

    const participants = await prisma.roster.findMany({
      where: { id: { in: row.participantRosterIds }, leagueId: row.leagueId },
      select: { id: true, platformUserId: true },
    })
    if (participants.length !== row.participantRosterIds.length) {
      throw new Error('One or more participant rosters are invalid for this league')
    }
    for (const p of participants) {
      if (isOrphanPlatformUserId(p.platformUserId)) {
        throw new Error('Cannot start dispersal draft while a participant slot is still orphaned')
      }
    }

    let nextIndex = row.currentPickIndex
    const passed = new Set(row.passedRosterIds)
    while (nextIndex < row.draftOrder.length && passed.has(row.draftOrder[nextIndex]!)) {
      nextIndex++
    }

    const updated = await dispersalPrisma.dispersalDraft.update({
      where: { id: draftId },
      data: {
        status: 'in_progress',
        startedAt: new Date(),
        currentPickIndex: nextIndex,
      },
      include: { picks: { orderBy: { pickNumber: 'asc' } } },
    })

    const state = rowToState(updated)
    await syncParticipantOnClockFlags(prisma, draftId, row.leagueId, nextIndex)
    return state
  }

  static async makePick(
    draftId: string,
    rosterId: string,
    assetId: string,
    opts?: { isAutoPick?: boolean }
  ): Promise<DispersalDraftState> {
    const after = await prisma.$transaction(
      async (rawTx) => {
        const tx = withDispersalModels(rawTx)
        const row = await tx.dispersalDraft.findUnique({
          where: { id: draftId },
          include: { picks: { orderBy: { pickNumber: 'asc' } } },
        })
        if (!row) throw new Error('Draft not found')
        if (row.status !== 'in_progress') throw new Error('Draft is not active')
        if (!row.participantRosterIds.includes(rosterId)) throw new Error('Roster is not a participant in this draft')
        if (row.passedRosterIds.includes(rosterId)) {
          throw new Error('You have passed out of this dispersal draft')
        }

        const assets = parseAssetPool(row.assetPool)
        const currentRoster = getCurrentRosterId(row.draftOrder, row.currentPickIndex, row.passedRosterIds)
        if (!currentRoster || currentRoster !== rosterId) {
          throw new Error('Not your pick')
        }

        const pickNo =
          row.picks.length > 0
            ? Math.max(...row.picks.map((p: { pickNumber: number }) => p.pickNumber)) + 1
            : 1
        const round = Math.ceil(pickNo / Math.max(1, row.picksPerRound))
        const pickInRound = ((pickNo - 1) % Math.max(1, row.picksPerRound)) + 1

        if (assetId === 'PASS' || assetId === 'pass') {
          const passed = [...new Set([...row.passedRosterIds, rosterId])]
          const nextIndex = advanceToNextSlot(row.draftOrder, row.currentPickIndex, passed)

          await tx.dispersalDraftPick.create({
            data: {
              dispersalDraftId: draftId,
              pickNumber: pickNo,
              round,
              pickInRound,
              rosterId,
              isPassed: true,
              pickedAt: new Date(),
            },
          })
          await tx.roster.updateMany({
            where: { id: rosterId, leagueId: row.leagueId },
            data: { dispersalDraftPasses: true },
          })

          let status: string = row.status
          let completedAt: Date | null = row.completedAt
          if (
            allParticipantsPassed(row.participantRosterIds, passed) ||
            allAssetsClaimed(assets) ||
            nextIndex >= row.draftOrder.length
          ) {
            status = 'completed'
            completedAt = new Date()
          }

          await tx.dispersalDraft.update({
            where: { id: draftId },
            data: {
              passedRosterIds: passed,
              currentPickIndex: nextIndex,
              status: status as never,
              completedAt,
            },
          })
          await syncParticipantOnClockFlags(tx, draftId, row.leagueId, nextIndex)
        } else {
          const asset =
            assets.find((a) => a.id === assetId && a.isAvailable) ||
            assets.find((a) => (a.playerId === assetId || a.id === assetId) && a.isAvailable)
          if (!asset || !asset.isAvailable) throw new Error('Asset not available')

          asset.isAvailable = false
          asset.claimedByRosterId = rosterId
          asset.claimedAt = new Date().toISOString()

          const display =
            asset.assetType === 'player'
              ? asset.playerName ?? asset.playerId ?? 'Player'
              : asset.assetType === 'draft_pick'
                ? asset.pickLabel ?? 'Draft pick'
                : asset.assetType === 'faab'
                  ? `FAAB $${asset.faabAmount ?? 0}`
                  : 'Asset'

          const nextIndex = advanceToNextSlot(row.draftOrder, row.currentPickIndex, row.passedRosterIds)

          const createdPick = await tx.dispersalDraftPick.create({
            data: {
              dispersalDraftId: draftId,
              pickNumber: pickNo,
              round,
              pickInRound,
              rosterId,
              assetType: asset.assetType,
              assetId: asset.playerId ?? asset.pickId ?? asset.id,
              assetDisplayName: display,
              isPassed: false,
              pickedAt: new Date(),
              isAutoPick: opts?.isAutoPick ?? false,
            },
          })

          await tx.dispersalAssetPool.updateMany({
            where: { draftId, playerId: asset.id },
            data: { isAvailable: false, pickedInPickId: createdPick.id },
          })

          let status: string = row.status
          let completedAt: Date | null = row.completedAt
          if (allAssetsClaimed(assets) || nextIndex >= row.draftOrder.length) {
            status = 'completed'
            completedAt = new Date()
          }

          await tx.dispersalDraft.update({
            where: { id: draftId },
            data: {
              assetPool: JSON.parse(JSON.stringify(assets)) as Prisma.InputJsonValue,
              currentPickIndex: nextIndex,
              status: status as never,
              completedAt,
            },
          })

          await syncParticipantOnClockFlags(tx, draftId, row.leagueId, nextIndex)
        }

        return tx.dispersalDraft.findUnique({
          where: { id: draftId },
          include: { picks: { orderBy: { pickNumber: 'asc' } } },
        })
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5000,
        timeout: 15000,
      }
    )

    if (!after) throw new Error('Draft not found')
    if (after.status === 'completed') {
      await DispersalDraftEngine.completeDraft(draftId)
    }
    return rowToState(after)
  }

  /**
   * Auto-pick when the pick timer expires: claims the best available asset (player first), else advances.
   */
  static async advancePickOnTimeout(draftId: string, rosterId: string): Promise<DispersalDraftState> {
    const row = await dispersalPrisma.dispersalDraft.findUnique({
      where: { id: draftId },
      include: { picks: { orderBy: { pickNumber: 'asc' } } },
    })
    if (!row) throw new Error('Draft not found')
    if (row.status !== 'in_progress') throw new Error('Draft is not active')
    if (!row.autoPickOnTimeout) throw new Error('Auto-pick on timeout is off')
    if (row.pickTimeSeconds <= 0) throw new Error('No pick timer configured')
    const current = getCurrentRosterId(row.draftOrder, row.currentPickIndex, row.passedRosterIds)
    if (!current || current !== rosterId) throw new Error('Not your pick')
    if (row.passedRosterIds.includes(rosterId)) throw new Error('You have passed out of this dispersal draft')

    const assets = parseAssetPool(row.assetPool)
    const candidate =
      assets.find((a) => a.isAvailable && a.assetType === 'player') ??
      assets.find((a) => a.isAvailable && a.assetType === 'draft_pick') ??
      assets.find((a) => a.isAvailable)
    if (candidate) {
      return DispersalDraftEngine.makePick(draftId, rosterId, candidate.id, { isAutoPick: true })
    }

    const after = await prisma.$transaction(
      async (rawTx) => {
        const tx = withDispersalModels(rawTx)
        const r = await tx.dispersalDraft.findUnique({
          where: { id: draftId },
          include: { picks: { orderBy: { pickNumber: 'asc' } } },
        })
        if (!r) throw new Error('Draft not found')
        const pool = parseAssetPool(r.assetPool)
        const pickNo =
          r.picks.length > 0
            ? Math.max(...r.picks.map((p: { pickNumber: number }) => p.pickNumber)) + 1
            : 1
        const round = Math.ceil(pickNo / Math.max(1, r.picksPerRound))
        const pickInRound = ((pickNo - 1) % Math.max(1, r.picksPerRound)) + 1
        const nextIndex = advanceToNextSlot(r.draftOrder, r.currentPickIndex, r.passedRosterIds)

        await tx.dispersalDraftPick.create({
          data: {
            dispersalDraftId: draftId,
            pickNumber: pickNo,
            round,
            pickInRound,
            rosterId,
            assetDisplayName: 'No assets left — turn skipped',
            isPassed: false,
            pickedAt: new Date(),
            isAutoPick: true,
          },
        })

        let status: string = r.status
        let completedAt: Date | null = r.completedAt
        if (allAssetsClaimed(pool) || nextIndex >= r.draftOrder.length) {
          status = 'completed'
          completedAt = new Date()
        }

        await tx.dispersalDraft.update({
          where: { id: draftId },
          data: {
            currentPickIndex: nextIndex,
            status: status as never,
            completedAt,
          },
        })
        await syncParticipantOnClockFlags(tx, draftId, r.leagueId, nextIndex)

        return tx.dispersalDraft.findUnique({
          where: { id: draftId },
          include: { picks: { orderBy: { pickNumber: 'asc' } } },
        })
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5000,
        timeout: 15000,
      }
    )

    if (!after) throw new Error('Draft not found')
    if (after.status === 'completed') {
      await DispersalDraftEngine.completeDraft(draftId)
    }
    return rowToState(after)
  }

  /**
   * Commissioner removes a manager from `passedRosterIds` — they re-enter at the next round’s pick
   * (not the current round). May advance `currentPickIndex` if the clock would otherwise land on them too soon.
   */
  static async removePassByCommissioner(draftId: string, rosterId: string): Promise<void> {
    await prisma.$transaction(async (rawTx) => {
      const tx = withDispersalModels(rawTx)
      const row = await tx.dispersalDraft.findUnique({ where: { id: draftId } })
      if (!row) throw new Error('Draft not found')
      if (row.status !== 'in_progress' && row.status !== 'configuring') {
        throw new Error('Draft is not active')
      }

      const passed = row.passedRosterIds.filter((id: string) => id !== rosterId)

      if (row.status !== 'in_progress') {
        await tx.dispersalDraft.update({
          where: { id: draftId },
          data: { passedRosterIds: passed },
        })
        await tx.roster.updateMany({
          where: { id: rosterId, leagueId: row.leagueId },
          data: { dispersalDraftPasses: false },
        })
        return
      }

      const ppr = Math.max(1, row.picksPerRound)
      const cur = row.currentPickIndex

      let nextIndex = cur
      let firstR: number | null = null
      for (let i = cur; i < row.draftOrder.length; i++) {
        if (row.draftOrder[i] === rosterId) {
          firstR = i
          break
        }
      }
      if (firstR != null) {
        const sameRound = Math.floor(firstR / ppr) === Math.floor(cur / ppr)
        if (sameRound) {
          const jump = nextRoundReentryPickIndex(row.draftOrder, ppr, rosterId, cur)
          if (jump != null) nextIndex = jump
        }
      }

      await tx.dispersalDraft.update({
        where: { id: draftId },
        data: {
          passedRosterIds: passed,
          ...(nextIndex !== cur ? { currentPickIndex: nextIndex } : {}),
        },
      })
      await tx.roster.updateMany({
        where: { id: rosterId, leagueId: row.leagueId },
        data: { dispersalDraftPasses: false },
      })
    })
  }

  /** @deprecated Prefer `makePick(..., 'PASS')` or `removePassByCommissioner` */
  static async passManager(
    draftId: string,
    rosterId: string,
    commissionerOverride: boolean = false
  ): Promise<void> {
    if (commissionerOverride) {
      await DispersalDraftEngine.removePassByCommissioner(draftId, rosterId)
      return
    }
    const row = await dispersalPrisma.dispersalDraft.findUnique({ where: { id: draftId } })
    if (!row) throw new Error('Draft not found')

    const passed = row.passedRosterIds.includes(rosterId)
      ? [...row.passedRosterIds]
      : [...row.passedRosterIds, rosterId]

    await prisma.$transaction([
      dispersalPrisma.dispersalDraft.update({
        where: { id: draftId },
        data: { passedRosterIds: passed },
      }),
      prisma.roster.updateMany({
        where: { id: rosterId, leagueId: row.leagueId },
        data: { dispersalDraftPasses: true },
      }),
    ])
  }

  static async completeDraft(draftId: string): Promise<void> {
    const row = await dispersalPrisma.dispersalDraft.findUnique({ where: { id: draftId } })
    if (!row || row.status !== 'completed') return

    const assets = parseAssetPool(row.assetPool)
    const participantSet = new Set(row.participantRosterIds)

    await prisma.$transaction(async (rawTx) => {
      const tx = withDispersalModels(rawTx)
      const unclaimedPlayerIds: string[] = []
      const unclaimedPickAuction: {
        assetId: string
        pickId?: string
        round?: number
        year?: number
        originalOwnerRosterId?: string
        tradedToRosterId?: string
        isTradedPick?: boolean
      }[] = []

      for (const asset of assets) {
        if (!asset.claimedByRosterId) {
          if (asset.assetType === 'faab' && asset.sourceRosterId) {
            await tx.roster.updateMany({
              where: { id: asset.sourceRosterId, leagueId: row.leagueId },
              data: { faabRemaining: 0 },
            })
          }
          if (asset.assetType === 'player' && asset.playerId) {
            unclaimedPlayerIds.push(String(asset.playerId))
            if (asset.sourceRosterId) {
              const src = await tx.roster.findFirst({
                where: { id: asset.sourceRosterId, leagueId: row.leagueId },
                select: { playerData: true },
              })
              if (src) {
                if (Array.isArray(src.playerData)) {
                  const filtered = src.playerData.filter((p: unknown) => {
                    const o = p && typeof p === 'object' ? (p as Record<string, unknown>) : null
                    const pid = o?.playerId ?? o?.player_id ?? o?.id
                    return String(pid) !== String(asset.playerId)
                  })
                  await tx.roster.update({
                    where: { id: asset.sourceRosterId },
                    data: { playerData: filtered },
                  })
                } else {
                  const root = readPlayerDataRoot(src.playerData)
                  const players = Array.isArray(root.players) ? root.players : []
                  root.players = players.filter((p: unknown) => {
                    const o = p && typeof p === 'object' ? (p as Record<string, unknown>) : null
                    const pid = o?.playerId ?? o?.player_id ?? o?.id
                    return String(pid) !== String(asset.playerId)
                  })
                  await tx.roster.update({
                    where: { id: asset.sourceRosterId },
                    data: { playerData: root as Prisma.InputJsonValue },
                  })
                }
              }
            }
          }
          if (asset.assetType === 'draft_pick') {
            unclaimedPickAuction.push({
              assetId: asset.id,
              pickId: asset.pickId,
              round: asset.pickRound,
              year: asset.pickYear,
              originalOwnerRosterId: asset.originalOwnerRosterId ?? asset.sourceRosterId,
              tradedToRosterId: asset.tradedToRosterId ?? asset.sourceRosterId,
              isTradedPick: asset.isTradedPick,
            })
          }
          continue
        }

        if (asset.assetType === 'faab' && asset.sourceRosterId) {
          await tx.roster.updateMany({
            where: { id: asset.sourceRosterId, leagueId: row.leagueId },
            data: { faabRemaining: 0 },
          })
          // QA: do NOT credit faabAmount to the claiming manager — the FAAB lot is consumed as a draft asset only.
          continue
        }

        if (asset.assetType === 'player' && asset.playerId) {
          const destId = asset.claimedByRosterId
          const dest = await tx.roster.findFirst({
            where: { id: destId, leagueId: row.leagueId },
            select: { playerData: true },
          })
          if (dest) {
            const root = readPlayerDataRoot(dest.playerData)
            const players = Array.isArray(root.players) ? root.players : []
            const already = players.some((p: unknown) => {
              const o = p && typeof p === 'object' ? (p as Record<string, unknown>) : null
              const pid = o?.playerId ?? o?.player_id ?? o?.id
              return String(pid) === String(asset.playerId)
            })
            if (!already) {
              players.push({
                playerId: asset.playerId,
                name: asset.playerName,
                position: asset.playerPosition,
                team: asset.playerTeam,
                source: 'dispersal_draft',
              })
            }
            root.players = players
            await tx.roster.update({
              where: { id: destId },
              data: { playerData: root as Prisma.InputJsonValue },
            })
          }

          const src = await tx.roster.findFirst({
            where: { id: asset.sourceRosterId, leagueId: row.leagueId },
            select: { playerData: true },
          })
          if (src) {
            if (Array.isArray(src.playerData)) {
              const filtered = src.playerData.filter((p: unknown) => {
                const o = p && typeof p === 'object' ? (p as Record<string, unknown>) : null
                const pid = o?.playerId ?? o?.player_id ?? o?.id
                return String(pid) !== String(asset.playerId)
              })
              await tx.roster.update({
                where: { id: asset.sourceRosterId },
                data: { playerData: filtered },
              })
            } else {
              const root = readPlayerDataRoot(src.playerData)
              const players = Array.isArray(root.players) ? root.players : []
              root.players = players.filter((p: unknown) => {
                const o = p && typeof p === 'object' ? (p as Record<string, unknown>) : null
                const pid = o?.playerId ?? o?.player_id ?? o?.id
                return String(pid) !== String(asset.playerId)
              })
              await tx.roster.update({
                where: { id: asset.sourceRosterId },
                data: { playerData: root as Prisma.InputJsonValue },
              })
            }
          }
        }

        if (asset.assetType === 'draft_pick' && asset.claimedByRosterId && asset.pickId) {
          const pickId = asset.pickId
          const destId = asset.claimedByRosterId
          const origOwner = asset.originalOwnerRosterId ?? asset.sourceRosterId
          const dest = await tx.roster.findFirst({
            where: { id: destId, leagueId: row.leagueId },
            select: { playerData: true },
          })
          if (dest) {
            const root = readPlayerDataRoot(dest.playerData)
            const rootRec = root as Record<string, unknown>
            const primaryKey = (['draftPicks', 'futurePicks', 'draft_picks', 'picks'] as const).find((k) =>
              Array.isArray(rootRec[k])
            )
            const key = primaryKey ?? 'draftPicks'
            const rawArr = rootRec[key]
            const draftPicks = Array.isArray(rawArr) ? [...rawArr] : []
            const row = {
              id: asset.pickId,
              pick_id: asset.pickId,
              season: asset.pickYear,
              year: asset.pickYear,
              pickYear: asset.pickYear,
              round: asset.pickRound,
              originalOwnerRosterId: origOwner,
              original_owner_id: origOwner,
              tradedToRosterId: destId,
              roster_id: destId,
              isTradedPick: asset.isTradedPick ?? false,
              is_traded: asset.isTradedPick ?? false,
              label: asset.pickLabel,
              source: 'dispersal_draft',
            }
            if (!draftPicks.some((raw) => draftPickMatchesAsset(raw, pickId))) {
              draftPicks.push(row)
            }
            rootRec[key] = draftPicks
            await tx.roster.update({
              where: { id: destId },
              data: {
                playerData: root as Prisma.InputJsonValue,
              },
            })
          }

          const src = await tx.roster.findFirst({
            where: { id: asset.sourceRosterId, leagueId: row.leagueId },
            select: { playerData: true },
          })
          if (src) {
            const root = readPlayerDataRoot(src.playerData)
            for (const pk of ['draftPicks', 'futurePicks', 'draft_picks', 'picks'] as const) {
              const v = root[pk]
              if (Array.isArray(v)) {
                root[pk] = v.filter((raw: unknown) => !draftPickMatchesAsset(raw, pickId))
              }
            }
            await tx.roster.update({
              where: { id: asset.sourceRosterId },
              data: { playerData: root as Prisma.InputJsonValue },
            })
          }
        }
      }

      const leagueRow = await tx.league.findFirst({
        where: { id: row.leagueId },
        select: { settings: true },
      })
      const prev = asJsonRecord(leagueRow?.settings ?? {})
      const eligibleBidders = (await tx.roster.findMany({
        where: { leagueId: row.leagueId },
        select: { id: true },
      }))
        .map((r: { id: string }) => r.id)
        .filter((id: string) => !participantSet.has(id))

      await tx.league.update({
        where: { id: row.leagueId },
        data: {
          settings: {
            ...prev,
            dispersalDraftLastCompletion: {
              draftId,
              completedAt: new Date().toISOString(),
              waiverWirePlayerIds: unclaimedPlayerIds,
              faabAuctionForNonParticipants: unclaimedPickAuction.map((p: {
                assetId: string
                pickId?: string
                round?: number
                year?: number
                originalOwnerRosterId?: string
                tradedToRosterId?: string
                isTradedPick?: boolean
              }) => ({
                ...p,
                eligibleBidderRosterIds: eligibleBidders,
              })),
            },
          } as Prisma.InputJsonValue,
        },
      })

      await tx.roster.updateMany({
        where: { leagueId: row.leagueId },
        data: { dispersalDraftPasses: false },
      })
    })
  }

  static async getDraftState(draftId: string): Promise<DispersalDraftState | null> {
    const row = await dispersalPrisma.dispersalDraft.findUnique({
      where: { id: draftId },
      include: { picks: { orderBy: { pickNumber: 'asc' } } },
    })
    if (!row) return null
    return rowToState(row)
  }

  static async getActiveDraftForLeague(leagueId: string): Promise<DispersalDraftState | null> {
    const row = await dispersalPrisma.dispersalDraft.findFirst({
      where: {
        leagueId,
        status: { in: ['pending', 'configuring', 'in_progress'] },
      },
      orderBy: { updatedAt: 'desc' },
      include: { picks: { orderBy: { pickNumber: 'asc' } } },
    })
    if (!row) return null
    return rowToState(row)
  }
}
