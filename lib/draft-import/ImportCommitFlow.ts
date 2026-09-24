/**
 * Commit import: backup current state, apply preview in transaction, optional rollback.
 * Deterministic; no AI.
 */

import { prisma } from '@/lib/prisma'
import type { DraftImportPreview } from './DraftImportPreview'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'

export interface ImportCommitResult {
  success: boolean
  error?: string
  backupId?: string
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

function buildImportFingerprint(input: {
  slotOrder: Array<{ slot: number; rosterId: string; displayName?: string | null }>
  picks: Array<{ overall: number; round: number; slot: number; rosterId: string; playerName: string; position: string; team?: string | null }>
  tradedPicks?: Array<{ round: number; originalRosterId: string; newRosterId: string }>
  keeperSelections?: Array<{ rosterId: string; roundCost: number; playerName: string; position: string }>
  keeperConfig?: unknown
}): string {
  const normalized = {
    slotOrder: [...input.slotOrder]
      .map((entry) => [entry.slot, entry.rosterId, normalizeText(entry.displayName ?? '')] as const)
      .sort((a, b) => a[0] - b[0]),
    picks: [...input.picks]
      .map((pick) => [
        pick.overall,
        pick.round,
        pick.slot,
        pick.rosterId,
        normalizeText(pick.playerName),
        normalizeText(pick.position),
        normalizeText(pick.team ?? ''),
      ] as const)
      .sort((a, b) => a[0] - b[0]),
    tradedPicks: [...(input.tradedPicks ?? [])]
      .map((pick) => [pick.round, pick.originalRosterId, pick.newRosterId] as const)
      .sort((a, b) => (a[0] - b[0]) || a[1].localeCompare(b[1])),
    keeperSelections: [...(input.keeperSelections ?? [])]
      .map((selection) => [
        selection.rosterId,
        selection.roundCost,
        normalizeText(selection.playerName),
        normalizeText(selection.position),
      ] as const)
      .sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1] || a[2].localeCompare(b[2])),
    keeperConfig: input.keeperConfig ?? null,
  }
  return JSON.stringify(normalized)
}

/**
 * Create backup of current draft session state (for rollback). Returns backup id.
 */
export async function createImportBackup(leagueId: string): Promise<string | null> {
  const session = await prisma.draftSession.findFirst({
    where: { leagueId },
    orderBy: CURRENT_DRAFT_SESSION_ORDER,
    include: { picks: { orderBy: { overall: 'asc' } } },
  })
  if (!session) return null
  const snapshot = {
    sessionPatch: {
      slotOrder: session.slotOrder,
      tradedPicks: session.tradedPicks,
      keeperConfig: session.keeperConfig,
      keeperSelections: session.keeperSelections,
      status: session.status,
      version: session.version,
      rounds: session.rounds,
      teamCount: session.teamCount,
      draftType: session.draftType,
      thirdRoundReversal: session.thirdRoundReversal,
    },
    picks: session.picks.map((p) => ({
      overall: p.overall,
      round: p.round,
      slot: p.slot,
      rosterId: p.rosterId,
      displayName: p.displayName,
      playerName: p.playerName,
      position: p.position,
      team: p.team,
      byeWeek: p.byeWeek,
      playerId: p.playerId,
      tradedPickMeta: p.tradedPickMeta,
      source: p.source,
      amount: p.amount,
    })),
  }
  const backup = await prisma.draftImportBackup.upsert({
    where: { leagueId },
    create: { leagueId, snapshot: snapshot as any },
    update: { snapshot: snapshot as any },
  })
  return backup.id
}

/**
 * Apply import preview to draft session. Runs in transaction. Creates backup first if backupBeforeCommit.
 */
export async function commitImport(
  leagueId: string,
  preview: DraftImportPreview,
  options: { backupBeforeCommit?: boolean } = {}
): Promise<ImportCommitResult> {
  const session = await prisma.draftSession.findFirst({
    where: { leagueId },
    orderBy: CURRENT_DRAFT_SESSION_ORDER,
    include: { picks: true },
  })
  if (!session) return { success: false, error: 'Draft session not found' }
  if (!Array.isArray(preview.slotOrder) || preview.slotOrder.length < 1) {
    return { success: false, error: 'Import preview must include slotOrder with at least one slot.' }
  }

  const currentFingerprint = buildImportFingerprint({
    slotOrder: (session.slotOrder as Array<{ slot: number; rosterId: string; displayName?: string | null }>) ?? [],
    picks: session.picks.map((pick) => ({
      overall: pick.overall,
      round: pick.round,
      slot: pick.slot,
      rosterId: pick.rosterId,
      playerName: pick.playerName,
      position: pick.position,
      team: pick.team,
    })),
    tradedPicks: (session.tradedPicks as Array<{ round: number; originalRosterId: string; newRosterId: string }>) ?? [],
    keeperSelections: (session.keeperSelections as Array<{ rosterId: string; roundCost: number; playerName: string; position: string }>) ?? [],
    keeperConfig: session.keeperConfig,
  })
  const incomingFingerprint = buildImportFingerprint({
    slotOrder: preview.slotOrder,
    picks: preview.picks,
    tradedPicks: preview.tradedPicks,
    keeperSelections: preview.keeperSelections,
    keeperConfig: preview.keeperConfig,
  })
  if (currentFingerprint === incomingFingerprint) {
    return { success: false, error: 'Duplicate import detected: imported draft state matches current session.' }
  }

  let backupId: string | null = null
  if (options.backupBeforeCommit) {
    backupId = await createImportBackup(leagueId)
  }

  try {
    await prisma.$transaction(async (tx) => {
      const sess = await (tx as any).draftSession.findFirst({ where: { leagueId }, orderBy: CURRENT_DRAFT_SESSION_ORDER })
      if (!sess) throw new Error('Draft session not found')
      await (tx as any).draftPick.deleteMany({ where: { sessionId: sess.id } })
      const sessionId = sess.id
      const teamCount = preview.slotOrder.length
      const importedMaxRound = preview.picks.length > 0 ? Math.max(...preview.picks.map((pick) => pick.round)) : 0
      const rounds = preview.metadata?.rounds ?? (importedMaxRound > 0 ? importedMaxRound : sess.rounds)
      const safeRounds = Math.max(1, Math.trunc(Number(rounds) || sess.rounds || 1))
      const safeTeamCount = Math.max(1, Math.trunc(Number(preview.metadata?.teamCount ?? teamCount) || teamCount))
      for (const p of preview.picks) {
        await (tx as any).draftPick.create({
          data: {
            sessionId,
            sportType: (sess as any).sportType ?? null,
            overall: p.overall,
            round: p.round,
            slot: p.slot,
            rosterId: p.rosterId,
            displayName: p.displayName,
            playerName: p.playerName,
            position: p.position,
            team: p.team,
            byeWeek: p.byeWeek,
            playerId: p.playerId,
            tradedPickMeta: p.tradedPickMeta ?? undefined,
            source: p.source ?? 'user',
            amount: p.amount ?? undefined,
          },
        })
      }
      const nextStatus = preview.picks.length < 1
        ? 'pre_draft'
        : preview.picks.length >= safeTeamCount * safeRounds
          ? 'completed'
          : 'in_progress'
      await (tx as any).draftSession.update({
        where: { id: sessionId },
        data: {
          slotOrder: preview.slotOrder as any,
          tradedPicks: (preview.tradedPicks ?? []) as any,
          keeperConfig: preview.keeperConfig ?? (sess.keeperConfig as any),
          keeperSelections: preview.keeperSelections ?? (sess.keeperSelections as any),
          rounds: safeRounds,
          teamCount: safeTeamCount,
          draftType: preview.metadata?.draftType ?? sess.draftType,
          thirdRoundReversal: preview.metadata?.thirdRoundReversal ?? sess.thirdRoundReversal,
          status: nextStatus,
          version: { increment: 1 },
          updatedAt: new Date(),
        },
      })
    })
    return { success: true, backupId: backupId ?? undefined }
  } catch (e) {
    return { success: false, error: (e as Error).message, backupId: backupId ?? undefined }
  }
}

/**
 * Rollback last import: restore session and picks from backup.
 */
export async function rollbackImport(leagueId: string): Promise<ImportCommitResult> {
  const backup = await prisma.draftImportBackup.findUnique({
    where: { leagueId },
  })
  if (!backup) return { success: false, error: 'No import backup found for this league' }
  const snapshot = backup.snapshot as {
    sessionPatch: {
      slotOrder: unknown
      tradedPicks: unknown
      keeperConfig: unknown
      keeperSelections: unknown
      status: string
      version: number
      rounds?: number
      teamCount?: number
      draftType?: string
      thirdRoundReversal?: boolean
    }
    picks: Array<{
      overall: number
      round: number
      slot: number
      rosterId: string
      displayName: string | null
      playerName: string
      position: string
      team: string | null
      byeWeek: number | null
      playerId: string | null
      tradedPickMeta?: unknown
      source: string | null
      amount?: number | null
    }>
  }
  const session = await prisma.draftSession.findFirst({
    where: { leagueId },
    orderBy: CURRENT_DRAFT_SESSION_ORDER,
  })
  if (!session) return { success: false, error: 'Draft session not found' }

  try {
    await prisma.$transaction(async (tx) => {
      await (tx as any).draftPick.deleteMany({ where: { sessionId: session.id } })
      const patch = snapshot.sessionPatch
      for (const p of snapshot.picks ?? []) {
        await (tx as any).draftPick.create({
          data: {
            sessionId: session.id,
            sportType: (session as any).sportType ?? null,
            overall: p.overall,
            round: p.round,
            slot: p.slot,
            rosterId: p.rosterId,
            displayName: p.displayName,
            playerName: p.playerName,
            position: p.position,
            team: p.team,
            byeWeek: p.byeWeek,
            playerId: p.playerId,
            tradedPickMeta: p.tradedPickMeta ?? undefined,
            source: p.source ?? 'user',
            amount: p.amount ?? undefined,
          },
        })
      }
      await (tx as any).draftSession.update({
        where: { id: session.id },
        data: {
          slotOrder: patch.slotOrder,
          tradedPicks: patch.tradedPicks,
          keeperConfig: patch.keeperConfig,
          keeperSelections: patch.keeperSelections,
          status: patch.status,
          version: patch.version,
          rounds: patch.rounds ?? session.rounds,
          teamCount: patch.teamCount ?? session.teamCount,
          draftType: patch.draftType ?? session.draftType,
          thirdRoundReversal: patch.thirdRoundReversal ?? session.thirdRoundReversal,
          updatedAt: new Date(),
        },
      })
    })
    await prisma.draftImportBackup.delete({ where: { id: backup.id } })
    return { success: true }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
}

/**
 * Check if rollback is available for league.
 */
export async function hasImportBackup(leagueId: string): Promise<boolean> {
  const b = await prisma.draftImportBackup.findUnique({ where: { leagueId } })
  return !!b
}
