import { prisma } from '@/lib/prisma'
import { emitDraftHealth } from '@/lib/draft/observability'
import { resolveCurrentOnTheClock } from '@/lib/live-draft-engine/CurrentOnTheClockResolver'
import type { ChimmyAlertSignalBundle } from './types'
import type { SlotOrderEntry } from '@/lib/live-draft-engine/types'

type DraftSignalSlice = Pick<ChimmyAlertSignalBundle, 'onTheClock' | 'draftStartingSoon'>

/**
 * Phase 5F — Chimmy alert draft slice: **prefer `DraftSession`** (canonical), fall back to
 * `DraftRoomStateRow` only when no session row exists (legacy / mock-era data).
 */
export async function loadChimmyDraftSignalSlice(
  leagueId: string,
  leagueTeamId: string,
  now: Date,
): Promise<DraftSignalSlice> {
  const out: DraftSignalSlice = {}

  const team = await prisma.leagueTeam.findFirst({
    where: { id: leagueTeamId, leagueId },
    select: { legacyRosterId: true },
  })
  const rosterId = team?.legacyRosterId?.trim() || null

  const draftSession = await prisma.draftSession.findUnique({
    where: { leagueId },
    select: {
      status: true,
      timerEndAt: true,
      teamCount: true,
      rounds: true,
      draftType: true,
      thirdRoundReversal: true,
      slotOrder: true,
      picks: {
        orderBy: { overall: 'asc' },
        select: { overall: true, playerName: true, position: true, pickMetadata: true },
      },
    },
  })

  if (draftSession) {
    const st = String(draftSession.status ?? '').trim().toLowerCase()
    if (st === 'pre_draft' && draftSession.timerEndAt) {
      const timerMs = draftSession.timerEndAt.getTime() - now.getTime()
      if (timerMs > 0 && timerMs < 1000 * 60 * 30) {
        out.draftStartingSoon = true
      }
    }

    const dtypeRaw = String(draftSession.draftType ?? 'snake').trim().toLowerCase()
    const draftType =
      dtypeRaw === 'linear' || dtypeRaw === 'auction' || dtypeRaw === 'snake'
        ? (dtypeRaw as 'snake' | 'linear' | 'auction')
        : 'snake'

    if (st === 'in_progress' && rosterId && draftType !== 'auction') {
      const slotOrder = (Array.isArray(draftSession.slotOrder)
        ? draftSession.slotOrder
        : []) as SlotOrderEntry[]
      const totalPicks = Math.max(1, draftSession.teamCount * draftSession.rounds)
      const current = resolveCurrentOnTheClock({
        totalPicks,
        picks: draftSession.picks.map((p) => ({
          overall: p.overall,
          playerName: p.playerName,
          position: p.position,
          pickMetadata: p.pickMetadata ?? null,
        })),
        teamCount: draftSession.teamCount,
        draftType,
        thirdRoundReversal: draftSession.thirdRoundReversal,
        slotOrder,
      })
      if (current?.rosterId === rosterId) {
        out.onTheClock = true
      }
    }

    return out
  }

  const draftState = await prisma.draftRoomStateRow.findFirst({
    where: { leagueId },
    select: { status: true, timerEndsAt: true, currentTeamIndex: true, pickOrder: true },
  })

  if (!draftState) {
    return out
  }

  emitDraftHealth('warn', 'chimmy_legacy_draft_signal_fallback', {
    leagueId,
    outcome: 'legacy_row_used',
    reason: String(draftState.status ?? ''),
  })

  if (draftState.status === 'active') {
    const pickOrder = Array.isArray(draftState.pickOrder) ? draftState.pickOrder : []
    const raw = pickOrder[draftState.currentTeamIndex] as { id?: string } | string | undefined
    const slotId =
      raw && typeof raw === 'object' && 'id' in raw
        ? String((raw as { id?: string }).id ?? '')
        : typeof raw === 'string'
          ? raw
          : ''
    if (slotId && rosterId && slotId === rosterId) {
      out.onTheClock = true
    } else if (slotId && slotId === leagueTeamId) {
      out.onTheClock = true
    }
  }

  if (draftState.status === 'waiting') {
    const timerMs = draftState.timerEndsAt ? draftState.timerEndsAt.getTime() - now.getTime() : null
    if (timerMs != null && timerMs > 0 && timerMs < 1000 * 60 * 30) {
      out.draftStartingSoon = true
    }
  }

  return out
}
