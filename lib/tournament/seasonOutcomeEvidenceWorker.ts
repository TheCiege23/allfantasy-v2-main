import 'server-only'
import { randomUUID } from 'node:crypto'
import { withAutomationLock } from '@/lib/automation/locks'
import { BlueprintOperationError } from './seasonBlueprintStore'
import { captureSeasonObservedBoxCandidates } from './seasonObservedBoxCapture'

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** One explicit league/day, at most ten candidate receipts. No scores or status promotion. */
export async function runSeasonOutcomeEvidenceJob(userId: string, tournamentId: string, freezeId: string,
  leagueKey: string, period: number, sourceDate: string) {
  if (process.env.TOURNAMENT_EVIDENCE_WORKER_ENABLED !== 'true') {
    throw new BlueprintOperationError('Tournament evidence capture is not enabled for this environment.', 409)
  }
  const lease = await withAutomationLock('tournament:rolling-insights:evidence',
    { owner: randomUUID(), ttlMs: 300_000 }, async () => {
      try {
        return await captureSeasonObservedBoxCandidates(userId, tournamentId, freezeId, leagueKey, period, sourceDate)
      } finally {
        // The capture itself waits six seconds between schedule and live. Keep the
        // global tournament lease for six more seconds before another job can fetch.
        await wait(6000)
      }
    })
  if (!lease.ok) throw new BlueprintOperationError('Tournament evidence capture is busy. Retry later.', 409)
  return lease.value
}
