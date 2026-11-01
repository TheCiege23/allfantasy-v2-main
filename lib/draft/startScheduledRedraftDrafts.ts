import 'server-only'

import { prisma } from '@/lib/prisma'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'
import { getDraftPoolReadiness, triggerDraftPoolPrewarmBackground } from '@/lib/draft-room/ensureDraftPoolReady'
import { withControlLock } from '@/lib/draft/draftLock'
import { buildSlotOrderForLeague, startDraftSession } from '@/lib/live-draft-engine/DraftSessionService'
import { SCHEDULED_REDRAFT_SPORTS, startsAtScheduledTimeRegardlessOfAutostart } from '@/lib/draft/redraftScheduledStart'
import { logStructured } from '@/lib/logging/structured'
import { resolveWriteAuthority } from '@/lib/league/write-authority'

export { SCHEDULED_REDRAFT_SPORTS }

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
 * Start one league's due scheduled draft, or record why not. Shared by the redraft and dynasty
 * starters so both apply the same setup checks, lock and notification as the Start button.
 */
async function startDueDraft(
  leagueId: string,
  draftDateUtc: Date | null,
  now: Date,
  summary: ScheduledRedraftDraftSummary,
  log: { event: string; sport: string | null },
): Promise<void> {
  const skip = (reason: string | null) => {
    summary.skipped++
    if (!reason) return
    summary.skips.push({ leagueId, reason })
    logStructured('info', log.event, 'skipped', { leagueId, reason })
  }
  try {
    // The query already bounds this; it is repeated so a future time can never start a draft.
    if (!draftDateUtc || draftDateUtc.getTime() > now.getTime()) {
      return skip(null)
    }
    const session = await prisma.draftSession.findFirst({
      where: { leagueId },
      orderBy: CURRENT_DRAFT_SESSION_ORDER,
      select: { status: true, sessionKind: true, sleeperDraftId: true, teamCount: true, slotOrder: true },
    })
    if (!session) {
      return skip('no_draft_session')
    }
    // Already started (or finished), a mock, or mirrored from Sleeper: nothing to do, quietly.
    if (session.status !== 'pre_draft' || session.sessionKind === 'mock' || session.sleeperDraftId) {
      return skip(null)
    }
    const blocker = await setupBlocker(leagueId, session)
    if (blocker) {
      return skip(blocker)
    }
    const pool = await getDraftPoolReadiness(leagueId)
    if (!pool.ready) {
      triggerDraftPoolPrewarmBackground(leagueId)
      return skip('pool_not_ready')
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
      skip(null)
    } else if (locked.value.ok) {
      summary.started++
      logStructured('info', log.event, 'started', { leagueId, sport: log.sport })
      // A manual start notifies from the controls route; a scheduled one has no caller to do it.
    } else if (locked.value.reason === 'session_not_ready') {
      // Lost the conditional claim to another start: someone else started it.
      skip(null)
    } else {
      // ROSTER_CONFIGURATION_INCOMPLETE and the like: setup the commissioner can fix; retried each tick.
      skip(locked.value.reason)
    }
  } catch (error) {
    summary.errors.push({ leagueId, error: error instanceof Error ? error.message : String(error) })
  }
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
      league: {
        select: {
          platform: true, sport: true, leagueType: true, isDynasty: true,
          survivorMode: true, guillotineMode: true, leagueVariant: true,
        },
      },
    },
    orderBy: { draftDateUtc: 'asc' },
    take: 100,
  })
  // The one predicate the settings UI also uses to hide the Autostart toggle. It repeats the SQL's
  // type/dynasty/sport bounds and adds what is filtered here rather than in SQL: the specialty
  // formats (their flag columns are nullable, and a SQL NOT over a NULL drops the row instead of
  // keeping it) and the native-platform check.
  const due = rows.filter(({ league }) => startsAtScheduledTimeRegardlessOfAutostart(league))
  const summary: ScheduledRedraftDraftSummary = { scanned: due.length, started: 0, skipped: 0, skips: [], errors: [] }
  for (const { leagueId, draftDateUtc, league } of due) {
    await startDueDraft(leagueId, draftDateUtc, now, summary, { event: 'scheduled_redraft_start', sport: league.sport ?? null })
  }
  return summary
}

/**
 * Called by the minute draft tick, after the redraft starter. Starts a native dynasty-family league's
 * draft (dynasty, devy, C2C: the startup draft or a rookie draft) at `LeagueSettings.draftDateUtc`
 * when the commissioner switched "Autostart Draft" on (phase 6, 2026-10-29).
 *
 * 🛑 THE TOGGLE WAS SAVED AND NOTHING READ IT. The redraft starter covers redraft leagues only and
 * the Survivor one specialty formats, so a dynasty commissioner who set a date and turned Autostart
 * on still had to press Start. A rookie draft opened by the calendar with "start it N days after it
 * opens" (`openDynastyRookieDraftsOnCalendar`) sets exactly that date and switch.
 *
 * Unlike redraft, Autostart is honoured rather than overridden: a dynasty draft date is often a
 * placeholder, and the switch is the commissioner's word that the time is real. A date is also
 * refused when a draft that has since COMPLETED was created after it was set — it belonged to that
 * draft (last year's startup or rookie draft), not the one now waiting.
 */
export async function startScheduledDynastyDrafts(now: Date = new Date()): Promise<ScheduledRedraftDraftSummary> {
  const rows = await prisma.leagueSettings.findMany({
    where: {
      autostart: true,
      draftDateUtc: { lte: now, gte: new Date(now.getTime() - LOOKBACK_MS) },
      league: {
        is: {
          OR: [
            { isDynasty: true },
            ...['dynasty', 'devy', 'c2c'].map((t) => ({ leagueType: { equals: t, mode: 'insensitive' as const } })),
          ],
        },
      },
    },
    select: {
      leagueId: true,
      draftDateUtc: true,
      league: { select: { platform: true, sport: true, survivorMode: true, guillotineMode: true, leagueVariant: true } },
    },
    orderBy: { draftDateUtc: 'asc' },
    take: 100,
  })
  const due = rows.filter(
    ({ league }) =>
      league.survivorMode !== true && league.guillotineMode !== true && league.leagueVariant !== 'guillotine' && resolveWriteAuthority(league.platform) === 'NATIVE',
  )
  const summary: ScheduledRedraftDraftSummary = { scanned: due.length, started: 0, skipped: 0, skips: [], errors: [] }
  for (const { leagueId, draftDateUtc, league } of due) {
    if (draftDateUtc && (await dateBelongsToFinishedDraft(leagueId, draftDateUtc))) {
      summary.skipped++
      continue
    }
    await startDueDraft(leagueId, draftDateUtc, now, summary, { event: 'scheduled_dynasty_start', sport: league.sport ?? null })
  }
  return summary
}

/** A completed draft created after this date: the date was that draft's, not the next one's. */
async function dateBelongsToFinishedDraft(leagueId: string, draftDateUtc: Date): Promise<boolean> {
  const finished = await prisma.draftSession.findFirst({
    where: { leagueId, status: 'completed', createdAt: { gte: draftDateUtc } },
    select: { id: true },
  })
  return finished != null
}
