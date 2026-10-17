import 'server-only'

import { prisma } from '@/lib/prisma'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'
import { getDraftPoolReadiness, triggerDraftPoolPrewarmBackground } from '@/lib/draft-room/ensureDraftPoolReady'
import { withControlLock } from '@/lib/draft/draftLock'
import { startDraftSession } from '@/lib/live-draft-engine/DraftSessionService'
import { resolveWriteAuthority } from '@/lib/league/write-authority'

export interface ScheduledSurvivorDraftSummary {
  scanned: number
  started: number
  skipped: number
  errors: Array<{ leagueId: string; error: string }>
}

/** Called by the minute draft tick; only native Survivor leagues that opted into autostart qualify. */
export async function startScheduledSurvivorDrafts(now: Date = new Date()): Promise<ScheduledSurvivorDraftSummary> {
  const due = await prisma.leagueSettings.findMany({
    where: {
      autostart: true,
      draftDateUtc: { lte: now, gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) },
      league: { is: { survivorMode: true } },
    },
    select: { leagueId: true, league: { select: { platform: true } } },
    orderBy: { draftDateUtc: 'asc' },
    take: 100,
  })
  const summary: ScheduledSurvivorDraftSummary = { scanned: due.length, started: 0, skipped: 0, errors: [] }
  for (const { leagueId, league } of due) {
    try {
      if (resolveWriteAuthority(league.platform) !== 'NATIVE') {
        summary.skipped++
        continue
      }
      const session = await prisma.draftSession.findFirst({
        where: { leagueId }, orderBy: CURRENT_DRAFT_SESSION_ORDER,
        select: { status: true, sessionKind: true, sleeperDraftId: true },
      })
      if (!session || session.status !== 'pre_draft' || session.sessionKind === 'mock' || session.sleeperDraftId) {
        summary.skipped++
        continue
      }
      const pool = await getDraftPoolReadiness(leagueId)
      if (!pool.ready) {
        triggerDraftPoolPrewarmBackground(leagueId)
        summary.skipped++
        continue
      }
      const locked = await withControlLock(leagueId, async () => {
        const current = await prisma.draftSession.findFirst({
          where: { leagueId }, orderBy: CURRENT_DRAFT_SESSION_ORDER,
          select: { status: true, sessionKind: true, sleeperDraftId: true },
        })
        if (!current || current.status !== 'pre_draft' || current.sessionKind === 'mock' || current.sleeperDraftId) return null
        return startDraftSession(leagueId)
      })
      if (!locked.acquired || !locked.value) {
        summary.skipped++
      } else if (locked.value.ok) {
        summary.started++
      } else if (locked.value.reason === 'SURVIVOR_CAST_INCOMPLETE') {
        // A commissioner can claim the remaining seats and the next tick retries.
        summary.skipped++
      } else {
        summary.errors.push({ leagueId, error: locked.value.error ?? locked.value.reason })
      }
    } catch (error) {
      summary.errors.push({ leagueId, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return summary
}
