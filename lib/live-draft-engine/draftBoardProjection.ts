/**
 * The remaining board of a startup/redraft draft being run now — what its picks are priced from
 * (`lib/trade-value-console/draftBoardPickPricing.ts`, owner's call 2026-11-26).
 *
 * DB-first and cache-only: the draft session's own pick rows, and the draft room's WARM pool snapshot
 * for its ADP order. It never builds a pool (a cold build takes minutes and belongs to the draft room,
 * not to a trade grade) and never asks for a background rebuild: with no warm snapshot the board is
 * ordered by the league's chart instead, and the basis sentence says so.
 */

import { prisma } from '@/lib/prisma'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'
import { isDraftPickRowEmpty, isDraftPickSkipped } from './draftPickEmpty'
import type { LiveDraftBoard, LiveDraftBoardPlayer } from '@/lib/trade-value-console/draftBoardPickPricing'

type PickRow = { overall: number; playerName: string; position: string; playerId?: string | null; pickMetadata?: unknown | null }

/** PURE: the open overalls and drafted players of a board, from its pick rows. Exported for tests. */
export function draftBoardFromPickRows(args: {
  rounds: number
  teamCount: number
  picks: readonly PickRow[]
}): Pick<LiveDraftBoard, 'openOveralls' | 'drafted'> {
  const total = Math.max(0, Math.floor(args.rounds) * Math.floor(args.teamCount))
  const byOverall = new Map(args.picks.map((p) => [p.overall, p]))
  const openOveralls: number[] = []
  for (let o = 1; o <= total; o++) {
    const row = byOverall.get(o)
    if (!row || isDraftPickRowEmpty(row)) openOveralls.push(o)
  }
  const made = args.picks.filter((p) => !isDraftPickRowEmpty(p) && !isDraftPickSkipped(p))
  return {
    openOveralls,
    drafted: {
      names: made.map((p) => p.playerName).filter((n) => n && n.trim()),
      playerIds: made.map((p) => String(p.playerId ?? '').trim()).filter(Boolean),
    },
  }
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
        picks: { select: { overall: true, playerName: true, position: true, playerId: true, pickMetadata: true } },
      },
    })
    if (!session || session.status === 'completed') return null
    const rows = draftBoardFromPickRows({ rounds: session.rounds, teamCount: session.teamCount, picks: session.picks })
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
