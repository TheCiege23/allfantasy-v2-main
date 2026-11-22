/**
 * The server's dispersal-draft clock: every in-progress dispersal draft whose current pick has run out and that
 * auto-picks on timeout gets that auto-pick, from the every-minute `draft-tick` cron.
 *
 * Before this, nothing on the server ever moved a dispersal draft (see `pickDeadlineFor`): the only auto-pick
 * was the on-the-clock manager's own page, so a draft held for an abandoned team stopped on the first manager
 * who was not watching.
 *
 * It runs whether or not `DRAFT_TICK_CRON_ENABLED` is on. That flag guards picking on a manager's behalf in an
 * ordinary draft, which no one asked for; here the commissioner switched "Auto-pick on timeout" on when they set
 * the draft up, and set its clock — the same reasoning the cron applies to a scheduled start or an auto draft.
 *
 * Bounded, and one failure does not stop the rest: the next tick retries a draft that failed.
 */
import { prisma } from '@/lib/prisma'
import { DispersalDraftEngine, pickDeadlineFor } from './DispersalDraftEngine'

export type ExpiredDispersalPicksSummary = { scanned: number; advanced: number; errors: { draftId: string; error: string }[] }

export async function processExpiredDispersalPicks(opts: { now?: Date; maxDrafts?: number } = {}): Promise<ExpiredDispersalPicksSummary> {
  const now = opts.now ?? new Date()
  const rows = await prisma.dispersalDraft.findMany({
    where: { status: 'in_progress', autoPickOnTimeout: true, pickTimeSeconds: { gt: 0 } },
    orderBy: { updatedAt: 'asc' },
    take: Math.max(1, Math.min(opts.maxDrafts ?? 25, 100)),
    select: { id: true, status: true, pickTimeSeconds: true, updatedAt: true },
  })
  const summary: ExpiredDispersalPicksSummary = { scanned: rows.length, advanced: 0, errors: [] }
  for (const row of rows) {
    const deadline = pickDeadlineFor(row)
    if (!deadline || now.getTime() < deadline.getTime()) continue
    try {
      if (await DispersalDraftEngine.advanceExpiredPick(row.id, now)) summary.advanced += 1
    } catch (e) {
      // A real pick landed between the read and the auto-pick: the draft moved on, which is the point.
      if (e instanceof Error && e.message === 'Not your pick') continue
      summary.errors.push({ draftId: row.id, error: (e instanceof Error ? e.message : String(e)).slice(0, 200) })
    }
  }
  return summary
}
