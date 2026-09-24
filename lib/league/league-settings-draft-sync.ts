import type { LeagueSettings } from '@prisma/client'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { pickTimerSecondsFromLeagueSettings } from '@/lib/league/league-settings-pick-timer'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'

type SlotRow = { slot: number; rosterId: string; displayName: string }

function draftTypeToSessionFields(draftType: string): { draftType: string; thirdRoundReversal: boolean } {
  const x = String(draftType ?? '').trim().toLowerCase()

  // Third-round reversal modifier (both id variants) — snake pick order + 3RR flag
  if (x === '3rd_reversal' || x === 'third_round_reversal') {
    return { draftType: 'snake', thirdRoundReversal: true }
  }

  // Auction and all auction variants (devy_auction, c2c_auction)
  if (x === 'auction' || x.endsWith('_auction')) {
    return { draftType: 'auction', thirdRoundReversal: false }
  }

  // Linear and all linear variants (devy_linear, c2c_linear)
  if (x === 'linear' || x.endsWith('_linear')) {
    return { draftType: 'linear', thirdRoundReversal: false }
  }

  // Execution modes — map to snake pick order; execution flags are stored
  // separately in LeagueSettings.aiAutoPick / League.settings.draft_execution_offline.
  if (x === 'offline' || x === 'auto' || x === 'team') {
    return { draftType: 'snake', thirdRoundReversal: false }
  }

  // Practice + lifecycle aliases with explicit order mode.
  if (
    x === 'mock_linear' ||
    x === 'slow_linear' ||
    x === 'supplemental_linear' ||
    x === 'dispersal_linear' ||
    x === 'mock_draft_linear' ||
    x === 'slow_draft_linear' ||
    x === 'supplemental_draft_linear' ||
    x === 'dispersal_draft_linear'
  ) {
    return { draftType: 'linear', thirdRoundReversal: false }
  }
  if (
    x === 'mock_snake' ||
    x === 'slow_snake' ||
    x === 'supplemental_snake' ||
    x === 'dispersal_snake' ||
    x === 'mock_draft_snake' ||
    x === 'slow_draft_snake' ||
    x === 'supplemental_draft_snake' ||
    x === 'dispersal_draft_snake'
  ) {
    return { draftType: 'snake', thirdRoundReversal: false }
  }

  // Async / practice modes — snake pick order, no 3RR
  if (x === 'mock_draft' || x === 'slow_draft') {
    return { draftType: 'snake', thirdRoundReversal: false }
  }

  // Lifecycle phases — snake pick order by default
  if (x === 'supplemental_draft' || x === 'dispersal_draft' || x === 'rookie_draft' || x === 'startup_draft') {
    return { draftType: 'snake', thirdRoundReversal: false }
  }

  // Snake and all snake variants (devy_snake, c2c_snake) — default pick order
  return { draftType: 'snake', thirdRoundReversal: false }
}

/** Map LeagueSettings.draftOrderSlots JSON to DraftSession.slotOrder (rosterId = team id). */
export function draftOrderSlotsToSlotOrder(
  draftOrderSlots: unknown,
  fallbackTeamCount: number,
): SlotRow[] {
  if (!Array.isArray(draftOrderSlots)) return []
  const rows: SlotRow[] = []
  for (const raw of draftOrderSlots) {
    if (!raw || typeof raw !== 'object') continue
    const o = raw as Record<string, unknown>
    const slot = typeof o.slot === 'number' ? o.slot : Number(o.slot)
    const ownerId = typeof o.ownerId === 'string' ? o.ownerId : null
    const ownerName = typeof o.ownerName === 'string' ? o.ownerName : 'Team'
    if (!Number.isFinite(slot) || slot < 1 || !ownerId) continue
    rows.push({ slot, rosterId: ownerId, displayName: ownerName })
  }
  rows.sort((a, b) => a.slot - b.slot)
  if (rows.length >= fallbackTeamCount) return rows
  return rows
}

/**
 * Push LeagueSettings onto an existing DraftSession (pre-draft / commissioner updates).
 */
export async function syncDraftSessionFromLeagueSettings(
  leagueId: string,
  ls: LeagueSettings,
  leagueTeamCount: number,
): Promise<void> {
  const session = await prisma.draftSession.findFirst({ where: { leagueId }, orderBy: CURRENT_DRAFT_SESSION_ORDER })
  if (!session) return

  const timerSeconds = pickTimerSecondsFromLeagueSettings(ls.pickTimerPreset, ls.pickTimerCustomValue)
  const { draftType, thirdRoundReversal } = draftTypeToSessionFields(ls.draftType)
  const slotOrder = draftOrderSlotsToSlotOrder(ls.draftOrderSlots, leagueTeamCount)
  const slotOrderJson: Prisma.InputJsonValue =
    slotOrder.length > 0
      ? (slotOrder as unknown as Prisma.InputJsonValue)
      : (session.slotOrder as Prisma.InputJsonValue)

  await prisma.draftSession.update({
    where: { id: session.id },
    data: {
      timerSeconds,
      draftType,
      thirdRoundReversal,
      rounds: Math.max(1, Math.min(50, ls.rounds)),
      aiAutoPick: ls.aiAutoPick,
      cpuAutoPick: ls.cpuAutoPick,
      playerPool: ls.playerPool,
      alphabeticalSort: ls.alphabeticalSort,
      ...(slotOrder.length > 0 ? { slotOrder: slotOrderJson } : {}),
      version: { increment: 1 },
    },
  })
}
