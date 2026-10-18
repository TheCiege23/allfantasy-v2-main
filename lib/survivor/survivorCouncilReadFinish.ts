import 'server-only'

import { publishCouncilVerdictIfComplete } from './survivorVoteTallyService'
import { resolveElimination, type EliminationOutcome } from './survivorEliminationService'

export type FinishReadOutcome =
  | { ok: true; complete: false }
  | { ok: true; complete: true; elimination: EliminationOutcome | null }
  | { ok: false; status: number; code: string; error: string }

/**
 * Finish a Tribal Council read once its last ballot is out: publish the verdict (chat, revote) and then
 * resolve the elimination. Before the read completes it does nothing, so no surface names the voted-out
 * manager early. Idempotent — the cron, reveal_next and the commissioner controls may all call it.
 */
export async function finishCouncilReadIfComplete(leagueId: string, councilId: string, actorUserId?: string): Promise<FinishReadOutcome> {
  const verdict = await publishCouncilVerdictIfComplete(leagueId, councilId)
  if (!verdict.ok) return verdict
  if (!verdict.complete) return { ok: true, complete: false }
  if (verdict.isTie || !verdict.eliminatedUserId) return { ok: true, complete: true, elimination: null }
  return { ok: true, complete: true, elimination: await resolveElimination(leagueId, councilId, actorUserId) }
}
