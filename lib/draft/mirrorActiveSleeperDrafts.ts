/**
 * Mirror externally-hosted Sleeper drafts onto our board.
 *
 * `syncDraftFromSleeper` has existed and worked for some time with ZERO callers — its only
 * reference in the repo was its own definition, and `POST /api/draft/sync` (the route that
 * wraps it) had none either. So a league whose draft runs on Sleeper showed an empty board
 * here no matter what happened upstream.
 *
 * This is the caller. It is deliberately the same shape as `processExpiredDraftPicks`:
 * a bounded scan, per-draft failure isolation, and a summary the cron can report.
 *
 * ⚠ READ-ONLY, AND THAT IS WHY IT IS NOT BEHIND DRAFT_TICK_CRON_ENABLED. That flag guards
 * server-side AUTOPICK — making picks on a manager's behalf, a visible behavioural change
 * to a live draft, correctly defaulted off. Mirroring makes no pick and changes nothing
 * upstream; it only copies what Sleeper already shows. Gating it behind the autopick switch
 * would leave the board dark for the wrong reason.
 *
 * ⚠ WE NEVER WRITE BACK TO SLEEPER. Sleeper owns the draft. Everything here is one
 * direction: their board, rendered on ours.
 */
import { prisma } from '@/lib/prisma'
import { syncDraftFromSleeper } from '@/lib/draft/sleeperSync'

export type MirrorSummary = {
  scanned: number
  mirrored: number
  failed: number
  /** Per-draft failure reasons, so an upstream outage is visible rather than a bare count. */
  failures: Array<{ draftSessionId: string; reason: string }>
}

/**
 * Statuses worth polling.
 *
 * `pre_draft` is included on purpose: that is when the draft ORDER appears, and a board
 * that only wakes up once picks start misses the thing managers check most in the days
 * before. `completed` is excluded — a finished draft never changes again, and re-mirroring
 * it every minute would delete and rewrite the same rows forever.
 */
const MIRRORABLE = ['pre_draft', 'in_progress', 'paused'] as const

export async function mirrorActiveSleeperDrafts(
  opts: { maxDrafts?: number } = {},
): Promise<MirrorSummary> {
  const maxDrafts = Math.min(Math.max(opts.maxDrafts ?? 40, 1), 200)

  const sessions = await prisma.draftSession.findMany({
    where: {
      sleeperDraftId: { not: null },
      status: { in: [...MIRRORABLE] },
    },
    select: { id: true, sleeperDraftId: true },
    // In-progress drafts first: a board someone is watching right now matters more than one
    // that starts next week.
    orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    take: maxDrafts,
  })

  const summary: MirrorSummary = { scanned: sessions.length, mirrored: 0, failed: 0, failures: [] }

  for (const s of sessions) {
    if (!s.sleeperDraftId) continue
    try {
      await syncDraftFromSleeper(s.sleeperDraftId, s.id)
      summary.mirrored += 1
    } catch (e) {
      // One league's outage must not stop the other thirty-nine.
      summary.failed += 1
      summary.failures.push({
        draftSessionId: s.id,
        reason: e instanceof Error ? e.message.slice(0, 120) : 'sync failed',
      })
    }
  }

  return summary
}
