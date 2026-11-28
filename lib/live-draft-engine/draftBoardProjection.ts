/**
 * The remaining board of a startup/redraft draft being run now — what its picks are priced from
 * (`lib/trade-value-console/draftBoardPickPricing.ts`, owner's call 2026-11-26).
 *
 * DB-first and cache-only: the draft session's own pick rows and keepers, and the draft room's WARM pool snapshot
 * for its ADP order. It never builds a pool (a cold build takes minutes and belongs to the draft room,
 * not to a trade grade) and never asks for a background rebuild: with no warm snapshot the board is
 * ordered by the league's chart instead, and the basis sentence says so.
 */

import { prisma } from '@/lib/prisma'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'
import { isDraftPickRowEmpty, isDraftPickSkipped } from './draftPickEmpty'
import type { LiveDraftBoard, LiveDraftBoardPlayer } from '@/lib/trade-value-console/draftBoardPickPricing'
import { buildKeeperLocks } from './keeper/KeeperDraftOrder'
import type { KeeperSelection } from './keeper/types'
import type { DraftType, SlotOrderEntry, TradedPickRecord } from './types'

type PickRow = { overall: number; playerName: string; position: string; playerId?: string | null; pickMetadata?: unknown | null }

/** A kept player: the slot his keeper cost locks (null when the cost is past the last round), and who he is. */
export type DraftBoardKeeper = { overall: number | null; playerName: string; playerId: string | null }

/**
 * PURE: the keepers of a draft, read the way the draft room reads them — the session's `keeperSelections`,
 * placed by `buildKeeperLocks` (the same call `DraftSessionService` makes for the room's `keeper.locks`).
 * A kept player is on his team's roster already, so he is off the board from the first pick, not from the
 * round his slot comes up (`DraftRoomPageClient` removes lock players from the available list the same way).
 */
export function draftBoardKeepers(args: {
  keeperConfig: unknown
  keeperSelections: unknown
  slotOrder: unknown
  tradedPicks: unknown
  teamCount: number
  rounds: number
  draftType: string
  thirdRoundReversal: boolean
}): DraftBoardKeeper[] {
  if (!args.keeperConfig || typeof args.keeperConfig !== 'object') return []
  const selections = (Array.isArray(args.keeperSelections) ? args.keeperSelections : []) as KeeperSelection[]
  if (selections.length === 0) return []
  const locks = buildKeeperLocks(
    selections,
    (Array.isArray(args.slotOrder) ? args.slotOrder : []) as SlotOrderEntry[],
    (Array.isArray(args.tradedPicks) ? args.tradedPicks : []) as TradedPickRecord[],
    args.teamCount,
    args.rounds,
    args.draftType as DraftType,
    args.thirdRoundReversal,
  )
  return selections
    .filter((s) => String(s?.playerName ?? '').trim() || String(s?.playerId ?? '').trim())
    .map((s) => {
      const lock = locks.find((l) => l.playerName === s.playerName && (l.playerId ?? null) === (s.playerId ?? null))
      return { overall: lock?.overall ?? null, playerName: String(s.playerName ?? '').trim(), playerId: String(s.playerId ?? '').trim() || null }
    })
}

/**
 * PURE: the open overalls and drafted players of a board, from its pick rows and its keepers. A keeper-locked
 * slot is not open (the keeper is auto-applied there; `PickSubmissionService` refuses anyone else), and a kept
 * player is taken. Exported for tests.
 */
export function draftBoardFromPickRows(args: {
  rounds: number
  teamCount: number
  picks: readonly PickRow[]
  keepers?: readonly DraftBoardKeeper[]
}): Pick<LiveDraftBoard, 'openOveralls' | 'drafted'> {
  const total = Math.max(0, Math.floor(args.rounds) * Math.floor(args.teamCount))
  const byOverall = new Map(args.picks.map((p) => [p.overall, p]))
  const keepers = args.keepers ?? []
  const locked = new Set(keepers.map((k) => k.overall).filter((o): o is number => o != null))
  const openOveralls: number[] = []
  for (let o = 1; o <= total; o++) {
    const row = byOverall.get(o)
    if ((!row || isDraftPickRowEmpty(row)) && !locked.has(o)) openOveralls.push(o)
  }
  const made = args.picks.filter((p) => !isDraftPickRowEmpty(p) && !isDraftPickSkipped(p))
  const names = made.map((p) => p.playerName).filter((n) => n && n.trim())
  const playerIds = made.map((p) => String(p.playerId ?? '').trim()).filter(Boolean)
  for (const k of keepers) {
    // A keeper already applied as a pick row is counted once.
    if (k.playerName && !names.includes(k.playerName)) names.push(k.playerName)
    if (k.playerId && !playerIds.includes(k.playerId)) playerIds.push(k.playerId)
  }
  return { openOveralls, drafted: { names, playerIds } }
}

type PoolEntry = {
  name?: string | null
  position?: string | null
  team?: string | null
  playerId?: string | null
  adp?: number | null
  aiAdp?: number | null
  display?: { playerId?: string | null; stats?: { projectedPointsPerGame?: number | null } | null } | null
}

/** PURE: the draft room's pool entries as the expected-order board (the room's own ADP order). Exported for tests. */
export function expectedBoardFromPool(
  entries: readonly PoolEntry[],
  compare: (a: PoolEntry, b: PoolEntry, ia: number, ib: number) => number,
): LiveDraftBoardPlayer[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => String(entry.name ?? '').trim())
    .sort((a, b) => compare(a.entry, b.entry, a.index, b.index))
    .map(({ entry }) => ({
      name: String(entry.name).trim(),
      position: entry.position ?? null,
      playerId: String(entry.display?.playerId ?? entry.playerId ?? '').trim() || null,
    }))
}

/**
 * The board of `sessionId` (else the league's current draft). Null when the draft cannot be read or is
 * over. Never throws.
 */
export async function loadLiveDraftBoard(args: { leagueId: string; sessionId?: string | null }): Promise<LiveDraftBoard | null> {
  try {
    const session = await prisma.draftSession.findFirst({
      where: args.sessionId ? { id: args.sessionId, leagueId: args.leagueId } : { leagueId: args.leagueId },
      orderBy: CURRENT_DRAFT_SESSION_ORDER,
      select: {
        status: true,
        rounds: true,
        teamCount: true,
        draftType: true,
        thirdRoundReversal: true,
        slotOrder: true,
        tradedPicks: true,
        keeperConfig: true,
        keeperSelections: true,
        picks: { select: { overall: true, playerName: true, position: true, playerId: true, pickMetadata: true } },
      },
    })
    if (!session || session.status === 'completed') return null
    const keepers = draftBoardKeepers({
      keeperConfig: session.keeperConfig,
      keeperSelections: session.keeperSelections,
      slotOrder: session.slotOrder,
      tradedPicks: session.tradedPicks,
      teamCount: session.teamCount,
      rounds: session.rounds,
      draftType: session.draftType,
      thirdRoundReversal: session.thirdRoundReversal,
    })
    const rows = draftBoardFromPickRows({ rounds: session.rounds, teamCount: session.teamCount, picks: session.picks, keepers })
    let expected: LiveDraftBoardPlayer[] | null = null
    try {
      // Dynamic: keeps the draft-pool stack off every importer of the review that never prices a board.
      const [{ getWarmDraftPoolSnapshotFast }, { compareDraftEntriesByStableRank }] = await Promise.all([
        import('@/lib/draft-room/ensureDraftPoolReady'),
        import('@/lib/draft-room/adp-ordering'),
      ])
      const snap = await getWarmDraftPoolSnapshotFast(args.leagueId)
      const entries = snap.warm && !snap.payload.rosterConfigurationIncomplete ? (snap.payload.entries as PoolEntry[] | undefined) : null
      if (entries && entries.length > 0) expected = expectedBoardFromPool(entries, compareDraftEntriesByStableRank)
    } catch {
      expected = null
    }
    return { ...rows, expected }
  } catch {
    return null
  }
}
