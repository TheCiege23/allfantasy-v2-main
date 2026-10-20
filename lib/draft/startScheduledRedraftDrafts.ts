import 'server-only'

import { prisma } from '@/lib/prisma'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'
import { getDraftPoolReadiness, triggerDraftPoolPrewarmBackground } from '@/lib/draft-room/ensureDraftPoolReady'
import { withControlLock } from '@/lib/draft/draftLock'
import { buildSlotOrderForLeague, startDraftSession } from '@/lib/live-draft-engine/DraftSessionService'
import { resolveWriteAuthority } from '@/lib/league/write-authority'
import { notifyDraftStartingSoon } from '@/lib/draft-notifications'
import { logStructured } from '@/lib/logging/structured'

/** Redraft sports whose scheduled drafts start on the server. */
export const SCHEDULED_REDRAFT_SPORTS = ['NFL', 'NBA', 'NHL', 'MLB'] as const

/** How far back a missed draft time still starts (a tick outage must not strand a draft). */
const LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000

export interface ScheduledRedraftDraftSummary {
  scanned: number
  started: number
  skipped: number
  /** Leagues that are due but cannot start yet, with the reason. Retried on every tick. */
  skips: Array<{ leagueId: string; reason: string }>
  errors: Array<{ leagueId: string; error: string }>
}

type SlotEntry = { slot?: unknown; rosterId?: unknown }

/** Same rule as DraftSessionService's isCompleteSlotOrder: one roster per seat, 1..teamCount. */
function isCompleteOrder(order: unknown, teamCount: number): order is SlotEntry[] {
  if (!Array.isArray(order) || teamCount < 1) return false
  const slots = new Set<number>()
  for (const e of order as SlotEntry[]) {
    if (!e || typeof e !== 'object') return false
    if (typeof e.slot !== 'number' || e.slot < 1 || e.slot > teamCount || slots.has(e.slot)) return false
    if (typeof e.rosterId !== 'string' || !e.rosterId) return false
    slots.add(e.slot)
  }
  return slots.size === teamCount
}

/**
 * Why a due draft cannot start yet, or null. A seat whose rosterId is `placeholder-N` has no
 * roster at all — nobody could be put on the clock for it — so a draft with one is not full.
 */
async function setupBlocker(
  leagueId: string,
  session: { teamCount: number; slotOrder: unknown },
): Promise<string | null> {
  if (session.teamCount < 2) return 'not_enough_teams'
  let order: unknown = session.slotOrder
  if (!isCompleteOrder(order, session.teamCount)) {
    // A manual start repairs a missing order from the league's rosters; accept what it would build.
    order = await buildSlotOrderForLeague(leagueId)
    if (!isCompleteOrder(order, session.teamCount)) return 'no_draft_order'
  }
  const seated = (order as SlotEntry[]).filter((e) => !String(e.rosterId).startsWith('placeholder-'))
  return seated.length < session.teamCount ? 'not_enough_teams' : null
}

/**
 * Called by the minute draft tick (`/api/cron/draft-tick`). Starts native redraft drafts (NFL, NBA,
 * NHL, MLB) whose `LeagueSettings.draftDateUtc` has passed, through the same `startDraftSession` the
 * commissioner's Start button calls. A scheduled redraft draft starts at its time whether or not
 * "Autostart Draft" is on (owner's decision, 2026-10-20): the draft time is the commitment.
 *
 * Survivor and Guillotine leagues are left to `startScheduledSurvivorDrafts`, which carries their
 * extra seat rules. Idempotency: the session is re-read under the control lock, and
 * `startDraftSession` itself claims the session with a conditional update on status and version,
 * so overlapping ticks cannot double-start a draft.
 */
export async function startScheduledRedraftDrafts(now: Date = new Date()): Promise<ScheduledRedraftDraftSummary> {
  const rows = await prisma.leagueSettings.findMany({
    where: {
      draftDateUtc: { lte: now, gte: new Date(now.getTime() - LOOKBACK_MS) },
      league: { is: { leagueType: 'redraft', isDynasty: false, sport: { in: [...SCHEDULED_REDRAFT_SPORTS] } } },
    },
    select: {
      leagueId: true,
      draftDateUtc: true,
      league: { select: { platform: true, sport: true, survivorMode: true, guillotineMode: true, leagueVariant: true } },
    },
    orderBy: { draftDateUtc: 'asc' },
    take: 100,
  })
  // Specialty formats filtered here rather than in SQL: their flag columns are nullable, and a SQL
  // NOT over a NULL drops the row instead of keeping it.
  const due = rows.filter(
    ({ league }) => league.survivorMode !== true && league.guillotineMode !== true && league.leagueVariant !== 'guillotine',
  )
  const summary: ScheduledRedraftDraftSummary = { scanned: due.length, started: 0, skipped: 0, skips: [], errors: [] }
  const skip = (leagueId: string, reason: string | null) => {
    summary.skipped++
    if (!reason) return
    summary.skips.push({ leagueId, reason })
    logStructured('info', 'scheduled_redraft_start', 'skipped', { leagueId, reason })
  }

  for (const { leagueId, draftDateUtc, league } of due) {
    try {
      // The query already bounds this; it is repeated so a future time can never start a draft.
      if (!draftDateUtc || draftDateUtc.getTime() > now.getTime()) {
        skip(leagueId, null)
        continue
      }
      if (resolveWriteAuthority(league.platform) !== 'NATIVE') {
        skip(leagueId, null)
        continue
      }
      const session = await prisma.draftSession.findFirst({
        where: { leagueId },
        orderBy: CURRENT_DRAFT_SESSION_ORDER,
        select: { status: true, sessionKind: true, sleeperDraftId: true, teamCount: true, slotOrder: true },
      })
      if (!session) {
        skip(leagueId, 'no_draft_session')
        continue
      }
      // Already started (or finished), a mock, or mirrored from Sleeper: nothing to do, quietly.
      if (session.status !== 'pre_draft' || session.sessionKind === 'mock' || session.sleeperDraftId) {
        skip(leagueId, null)
        continue
      }
      const blocker = await setupBlocker(leagueId, session)
      if (blocker) {
        skip(leagueId, blocker)
        continue
      }
      const pool = await getDraftPoolReadiness(leagueId)
      if (!pool.ready) {
        triggerDraftPoolPrewarmBackground(leagueId)
        skip(leagueId, 'pool_not_ready')
        continue
      }
      const locked = await withControlLock(leagueId, async () => {
        const current = await prisma.draftSession.findFirst({
          where: { leagueId },
          orderBy: CURRENT_DRAFT_SESSION_ORDER,
          select: { status: true, sessionKind: true, sleeperDraftId: true },
        })
        if (!current || current.status !== 'pre_draft' || current.sessionKind === 'mock' || current.sleeperDraftId) return null
        return startDraftSession(leagueId)
      })
      if (!locked.acquired || !locked.value) {
        skip(leagueId, null)
      } else if (locked.value.ok) {
        summary.started++
        logStructured('info', 'scheduled_redraft_start', 'started', { leagueId, sport: league.sport })
        // A manual start notifies from the controls route; a scheduled one has no caller to do it.
        await notifyDraftStartingSoon(leagueId).catch(() => {})
      } else if (locked.value.reason === 'session_not_ready') {
        // Lost the conditional claim to another start: someone else started it.
        skip(leagueId, null)
      } else {
        // ROSTER_CONFIGURATION_INCOMPLETE and the like: setup the commissioner can fix; retried each tick.
        skip(leagueId, locked.value.reason)
      }
    } catch (error) {
      summary.errors.push({ leagueId, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return summary
}
