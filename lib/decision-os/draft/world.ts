/**
 * Decision OS — World for `manager.draft.pick`.
 *
 * The draft facts the decision's rules are judged against, taken from the live draft session
 * snapshot (`buildSessionSnapshot`, the same state `/api/draft/room/state` serves) rather than
 * re-read. Pure: the snapshot arrives already loaded.
 *
 * ⚠ NOT `lib/decision-os/draft-os`. That module caches canonical league rules for a draft runtime
 * that no longer exists and says in its own header not to wire anything to it. Live drafts run on
 * `lib/live-draft-engine`, so that is what this world reads.
 */
import type { DraftSessionSnapshot, DraftSessionStatus } from '@/lib/live-draft-engine/types'
import { isDraftPickRowEmpty } from '@/lib/live-draft-engine/draftPickEmpty'

export interface DraftWorld {
  sessionId: string
  status: DraftSessionStatus
  draftType: DraftSessionSnapshot['draftType']
  rounds: number
  teamCount: number
  /** The roster the decision is for. */
  rosterId: string
  /** Who is on the clock now; null before the draft starts and after it ends. */
  onClockRosterId: string | null
  currentOverall: number | null
  currentRound: number | null
  /** Every filled pick on the board, for the already-drafted check. */
  existingPicks: Array<{ rosterId: string; playerName: string; position: string }>
  /** How many players this roster has drafted. */
  rosterPickCount: number
  /** Picks before this roster is up again, when the board says; 0 when on the clock. */
  picksUntilTurn: number | null
}

export interface DraftWorldInput {
  snapshot: Pick<
    DraftSessionSnapshot,
    'id' | 'status' | 'draftType' | 'rounds' | 'teamCount' | 'picks' | 'currentPick'
  >
  rosterId: string
  /** From the room's own board math; omitted when the caller does not know it. */
  picksUntilTurn?: number | null
}

export function resolveDraftWorld(input: DraftWorldInput): DraftWorld {
  const { snapshot, rosterId } = input
  const existingPicks = snapshot.picks
    .filter((p) => !p.pickEditorEmpty && !isDraftPickRowEmpty(p))
    .map((p) => ({ rosterId: p.rosterId, playerName: p.playerName, position: p.position }))
  const onClockRosterId = snapshot.currentPick?.rosterId ?? null
  return {
    sessionId: snapshot.id,
    status: snapshot.status,
    draftType: snapshot.draftType,
    rounds: snapshot.rounds,
    teamCount: snapshot.teamCount,
    rosterId,
    onClockRosterId,
    currentOverall: snapshot.currentPick?.overall ?? null,
    currentRound: snapshot.currentPick?.round ?? null,
    existingPicks,
    rosterPickCount: existingPicks.filter((p) => p.rosterId === rosterId).length,
    picksUntilTurn: onClockRosterId === rosterId ? 0 : input.picksUntilTurn ?? null,
  }
}
