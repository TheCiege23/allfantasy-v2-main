/**
 * Keep `DraftSession.nextOverallPick` / `currentRoundNum` true for a hosted live draft.
 *
 * 🛑 THE POINTER NEVER MOVED (2026-11-24). Only a reset (to 1), a Sleeper sync and an import wrote it.
 * The live engine works out the next open pick from the pick rows and never saved it, so every hosted
 * draft sat at pick 1 however far it had run — measured: all 4 hosted sessions with picks in production
 * disagreed with their own rows, all Sleeper-synced ones agreed. Draft HQ names the manager on the clock
 * from this column, the draft board marks the pick from it, and Chimmy's draft advice ranks the pool at it.
 *
 * Called inside each transaction that adds, removes or clears a pick, after the pick write, so the
 * pointer is derived from the same rows that transaction committed. It does not bump `version`: the
 * caller already did, and a second bump would break the version claims other writers race on.
 */
import { resolveNextOpenPickOverall } from '@/lib/live-draft-engine/draftPickEmpty'

type Tx = {
  draftSession: {
    findUnique: (args: any) => Promise<any>
    update: (args: any) => Promise<unknown>
  }
}

/** The pointer for a board: the first open pick, or one past the end when the board is full. */
export function draftProgressPointer(
  picks: ReadonlyArray<{ overall: number; playerName: string; position: string; pickMetadata?: unknown | null }>,
  rounds: number,
  teamCount: number,
): { nextOverallPick: number; currentRoundNum: number } {
  const total = Math.max(0, rounds * teamCount)
  const next = resolveNextOpenPickOverall([...picks], total) ?? total + 1
  const round = teamCount > 0 ? Math.min(Math.max(1, rounds), Math.ceil(next / teamCount)) : 1
  return { nextOverallPick: next, currentRoundNum: Math.max(1, round) }
}

export async function syncDraftProgressPointer(tx: Tx, sessionId: string): Promise<void> {
  const session = await tx.draftSession.findUnique({
    where: { id: sessionId },
    select: {
      rounds: true,
      teamCount: true,
      nextOverallPick: true,
      currentRoundNum: true,
      picks: { select: { overall: true, playerName: true, position: true, pickMetadata: true } },
    },
  })
  if (!session) return
  const pointer = draftProgressPointer(session.picks ?? [], session.rounds ?? 0, session.teamCount ?? 0)
  if (pointer.nextOverallPick === session.nextOverallPick && pointer.currentRoundNum === session.currentRoundNum) return
  await tx.draftSession.update({ where: { id: sessionId }, data: pointer })
}
