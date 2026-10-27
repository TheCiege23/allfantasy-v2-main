/**
 * GET/POST /api/cron/alert-sweep
 *
 * The scheduled evaluation that makes alerts reach people. Until this existed,
 * `runUnifiedAlertEngine` had exactly one caller — `/api/ai/alerts`, fetched by a React
 * component — so the platform was pull-only and could never notify a manager who had not
 * opened the app. That is the whole gap between "the system knows your starter is out" and
 * "you find out before kickoff".
 *
 * WHO IT SWEEPS (changed 2026-09-06). It used to sweep only users with a push subscription,
 * on the argument that evaluating the unreachable is pure cost. Measured on production
 * (2026-09-06, re-measured by the gate): zero push subscriptions ever, 23 users with a claimed
 * current-season team — 22 of those with a non-empty email on file — and zero injured-starter
 * notifications ever created across 592 successful runs in a week. Healthy, and reaching
 * nobody. It now sweeps everyone with a claimed team in the current season (push subscribers
 * first), and the dispatcher gates each on category preference, contact availability and
 * quiet hours. See lib/chimmy-alerts/sweepAudience.ts.
 *
 * ⚠ TWO POPULATIONS, REPORTED SEPARATELY. `usersScanned` is the audience (the union above);
 * `usersWithEmail` is how many of them the dispatcher's email gate can reach at all. A dry run
 * against production should read 23 and 22 — one number that both a healthy and a broken
 * audience query would produce is not a check, so neither figure stands in for the other.
 *
 * ⚠ ONE MESSAGE PER PLAYER, PER DESIGNATION, PER DAY. This route calls the detector directly,
 * not through the engine, so the engine's repeat cooldown does not apply; and the dispatcher's
 * email path sends whenever it is called. The pre-dispatch check on the in-app row's sourceKey
 * is what keeps a five-minute sweep from emailing the same fact twelve times an hour.
 *
 * TWO WEEKLY JOBS, SAME SWEEP: CHIMMY'S LINEUP AND WAIVER CHECKS (2026-09-24). Before the week's
 * main slate, Chimmy checks every claimed NFL lineup and messages the manager once when something
 * is still fixable (lib/chimmy-alerts/lineupCheck.ts); on Tuesday, once last week is played, it
 * names the best pickup on each wire when one is worth a claim (lib/chimmy-alerts/waiverCheck.ts).
 * They ride this route rather than new ones because they share the audience, the cadence and the
 * auth; outside their windows each costs two small reads. They report under `lineupCheck` and
 * `waiverCheck`, and record `cron-chimmy-lineup-check` / `cron-chimmy-waiver-check` rows only on a
 * run that actually ran for users, so a quiet day writes nothing.
 *
 * AND THE WAIVER CHECK FOR EVERY OTHER SPORT (2026-09-29, lib/chimmy-alerts/runSportWaiverCheck.ts):
 * the Waivers board's per-game sections — NBA, NCAAB, NHL, MLB daily in a morning window on game
 * days, NCAAF on Tuesday — on the per-sport rules in lib/chimmy-alerts/waiverAlertRules.ts, at most
 * one message per user per Eastern day. Separate from the NFL's Tuesday check, which is unchanged.
 * It reports under `sportWaiverCheck` and records `cron-chimmy-sport-waiver-check` only on a run
 * that actually ran for users.
 *
 * AND THE BEST BALL DEPTH CHECK (2026-10-08, lib/chimmy-alerts/runBestBallDepthCheck.ts): in the
 * lineup check's window, a best ball manager whose auto lineup has nobody healthy left at a position
 * gets one message for the week. The rule is the home card's (dash34 depthAlerts), red only. It
 * reports under `bestBallDepth` and records `cron-chimmy-best-ball-depth` only on a run that ran.
 *
 * AND A LOCK CHECK BEFORE EVERY OTHER SLATE (2026-10-08, lib/chimmy-alerts/runSlateLockCheck.ts): the
 * weekly lineup check covers only the main slate, so Thursday, Sunday night and Monday locked with no
 * check at all. 90 to 20 minutes before each of those, a manager with a swap worth taking, a starter
 * with no projection in that game, or an empty slot (once a week) gets one push for that slate.
 * Ruled-out starters stay with the injured-starter sweep above. It reports under `slateLock` and
 * records `cron-chimmy-slate-lock` only on a run that ran.
 *
 * A THIRD, SHIPPED OFF: THE GUILLOTINE CHOP-RELEASE ALERT (lib/chimmy-alerts/chopRelease.ts). When a
 * guillotine league's chopped roster hits waivers, each surviving member gets their own FAAB bid plan
 * for it. It does nothing — not one read — unless the service carries CHOP_RELEASE_ALERTS_ENABLED=1.
 * It reports under `chopRelease` and records `cron-chimmy-chop-release` only on a run that found a chop.
 *
 * AND SCHEDULED LEAGUE ANNOUNCEMENTS (2026-10-19, lib/commissioner/scheduledAnnouncementService.ts): a
 * commissioner's announcement written now and posted at the time they chose. It goes FIRST — it is a
 * handful of reads and is the one job here a person is watching the clock for — and so lands within one
 * sweep (15 minutes) of its time. No flag: a commissioner pressed Schedule, and "schedule" that never
 * posts is "save and forget". It reports under `scheduledAnnouncements` and records
 * `cron-scheduled-announcements` only on a run that posted or failed something.
 * AND THE STORYLINE STUDIO AUTO-POST (2026-10-26, lib/storyline-studio/storylineService.ts): the week's
 * top storyline hook (and, if asked, its prediction poll) posted to an AllFantasy league's chat at the
 * weekday and hour its commissioner chose. No flag, like scheduled announcements — a commissioner
 * switched it on (OFF by default) — but `STORYLINE_AUTOPOST=off` stops it without a deploy. Once per
 * league per fantasy week by the chat row's id; the poster's AF Commissioner plan is re-checked at send
 * time. It reports under `storylineAutoPost` and records `cron-storyline-autopost` only on a run that
 * posted or failed something.
 * AND THE DEADLINE AUTOPILOT, SHIPPED OFF (lib/deadline-autopilot/autopilotService.ts): the 72 h / 24 h /
 * 1 h reminders a commissioner switched on, sent to the managers who still have to act. Every sweep, so
 * the 1 h reminder lands 60 to 55 minutes out. Off unless `DEADLINE_AUTOPILOT_ENABLED=1`. It reports
 * under `deadlineAutopilot` and records `cron-deadline-autopilot` only on a run that sent something.
 *
 * Query params:
 *   dryRun=1     evaluate and report without sending (both jobs)
 *   limit=N      cap users processed this run (default 200)
 *   userId=...   evaluate a single user, for verification (both jobs)
 *   lineupCheck=force   run the lineup check outside its window (the weekly claim still holds)
 *   lineupCheck=off     skip the lineup check this run
 *   bestBallDepth=force run the best ball depth check outside its window (the weekly claim still holds)
 *   bestBallDepth=off   skip the best ball depth check this run
 *   slateLock=force     run the slate lock check for the next non-main slate (its claims still hold)
 *   slateLock=off       skip the slate lock check this run
 *   waiverCheck=force   run the waiver check outside its window (the weekly claim still holds)
 *   waiverCheck=off     skip the waiver check this run
 *   followFree=off      skip the followed-player free-agent check this run (it runs every sweep)
 *   sportWaiverCheck=force  run the other-sport waiver check outside its windows (in-season sports
 *                           only; the daily claim still holds)
 *   sportWaiverCheck=off    skip the other-sport waiver check this run
 *   chopRelease=off     skip the chop-release alert this run (it is also off unless the flag is set)
 *   scheduledAnnouncements=off  skip posting scheduled league announcements this run
 *   deadlineAutopilot=off  skip the deadline autopilot this run (it is also off unless the flag is set)
 *   storylineAutoPost=off  skip the Storyline Studio auto-post this run
 *
 * FAILS LOUDLY on a systemic error (no push configured, sweep threw). It does NOT fail when
 * zero alerts are found — on a Tuesday in the off-season that is the correct outcome, and a
 * cron that 500s daily for being correct is one nobody reads.
 */

import type { NextRequest } from 'next/server'
import { readPlayerNewsLevelFor, claimPlayerNewsEmailToday } from "@/lib/notifications/playerNewsGate"
import { NextResponse } from 'next/server'

import { requireCronAuth } from '@/app/api/cron/_auth'
import { prisma } from '@/lib/prisma'
import { getBaseUrl } from '@/lib/get-base-url'
import { renderInjuryEmail } from '@/lib/notifications/injuryEmail'
import { fetchSleeperStatuses } from '@/lib/autocoach/status-sources/SleeperStatusAdapter'
import { detectInjuredStarterAlerts } from '@/lib/chimmy-alerts/ChimmyAlertDetectors'
import { hydrateInjuredStarters } from '@/lib/chimmy-alerts/hydrateInjuredStarters'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import { sendPushToUser } from '@/lib/push-notifications'
import { apnsConfig } from '@/lib/push-notifications/apns'
import { decidePushForUser } from '@/lib/notifications/pushGate'
import { teamSweepTelemetry } from '@/lib/core-app/teamSweepPolicy'
import { recordSyncJobRun, withSyncJobRun } from '@/lib/production-health/syncJobRunTelemetry'
import { runLineupCheck, type LineupCheckRun } from '@/lib/chimmy-alerts/runLineupCheck'
import { runBestBallDepthCheck, type BestBallDepthRun } from '@/lib/chimmy-alerts/runBestBallDepthCheck'
import { runSlateLockCheck, type SlateLockRun } from '@/lib/chimmy-alerts/runSlateLockCheck'
import { runWaiverCheck, type WaiverCheckRun } from '@/lib/chimmy-alerts/runWaiverCheck'
import { runSportWaiverCheck, type SportWaiverCheckRun } from '@/lib/chimmy-alerts/runSportWaiverCheck'
import type { ChopReleaseRun } from '@/lib/chimmy-alerts/runChopReleaseCheck'
import { chopReleaseEnabled } from '@/lib/chimmy-alerts/chopRelease'
import type { ScheduledAnnouncementRun } from '@/lib/commissioner/scheduledAnnouncementService'
import type { AutopilotRun } from '@/lib/deadline-autopilot/autopilotService'
import type { AutoPostRun } from '@/lib/storyline-studio/storylineService'
import { runFollowFreeAgentCheck, type FollowFreeAgentRun } from '@/lib/follows/followFreeAgentCheck'
import { followFreeAgentDeps } from '@/lib/follows/followFreeAgentDeps'
import { injuredStarterDedupeKey, injuredStarterHref, mergeAudience } from '@/lib/chimmy-alerts/sweepAudience'
import { buildFanOutLeagues } from '@/lib/chimmy-alerts/injuryFanOut'
import { digestCopy, fanOutCopy, groupAlertsByPlayer } from '@/lib/chimmy-alerts/injuryFanOutCopy'
import { finalCallSms, injurySmsEnabled } from '@/lib/chimmy-alerts/finalCallSms'
import { allSportsInjuryAlertsEnabled, onGameDay } from '@/lib/chimmy-alerts/gameDayScope'
import { liveFirstSeen, planLiveFold, sleeperIdentities } from '@/lib/chimmy-alerts/liveStatusFold'
import { sleeperIdWhere } from '@/lib/player-identity/externalIdNamespace'
import type { ChimmyAlertContext } from '@/lib/chimmy-alerts/types'
import { loadChimmyAlertPreferences } from '@/lib/chimmy-alerts/ChimmyAlertPreferencesService'
import { preferenceMuteReason } from '@/lib/chimmy-alerts/ChimmyAlertSuppressionEngine'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Heartbeat identity in `sync_job_runs`. Must stay in step with PROBES in
 * scripts/cron-freshness-check.mjs — renaming it here without renaming it there makes the
 * freshness monitor report CONFIG ("no rows for job_name") forever.
 *
 * ⚠ THIS IS THE ONLY THING THAT CAN WATCH THIS JOB, WHICH IS WHY IT IS HERE.
 * The sweep's product of record is a push notification, not a row: it reads `webPushSubscription`
 * and sends. The one table it does touch — `SportsInjury`, via the game-window fold — is written
 * far more often by `/api/cron/import-injuries`, which is already probed on
 * `SportsInjury.fetchedAt`, so a table probe here would be satisfied by THAT job and report this
 * one healthy while it sent nothing. Until this heartbeat existed, alert-sweep could have stopped
 * delivering injured-starter alerts entirely and no monitor would have said a word.
 */
const JOB = 'cron-alert-sweep'

/** Recorded only when a weekly check actually ran for users — see the header. */
const LINEUP_CHECK_JOB = 'cron-chimmy-lineup-check'
const BEST_BALL_DEPTH_JOB = 'cron-chimmy-best-ball-depth'
const SLATE_LOCK_JOB = 'cron-chimmy-slate-lock'
/** "He's free in your league" for followed players (lib/follows/followFreeAgentCheck.ts). */
const FOLLOW_FREE_AGENT_JOB = 'cron-follow-free-agent'
const WAIVER_CHECK_JOB = 'cron-chimmy-waiver-check'
const SPORT_WAIVER_CHECK_JOB = 'cron-chimmy-sport-waiver-check'
const CHOP_RELEASE_JOB = 'cron-chimmy-chop-release'
const SCHEDULED_ANNOUNCEMENTS_JOB = 'cron-scheduled-announcements'
/** Posting is a few reads per league; this only stops a pathological backlog from eating the sweep. */
const SCHEDULED_ANNOUNCEMENTS_BUDGET_MS = 60_000
const DEADLINE_AUTOPILOT_JOB = 'cron-deadline-autopilot'
const STORYLINE_AUTOPOST_JOB = 'cron-storyline-autopost'
/** A handful of reads per due league; this only stops a backlog from eating the sweep. */
const STORYLINE_AUTOPOST_BUDGET_MS = 60_000

/**
 * A weekly check's share of a run. The injured-starter sweep goes first and is the reason this
 * route exists; a check stops starting new users past this and resumes on the next run. Only one
 * check is ever inside its window at a time (Sunday morning, Tuesday), so they do not compete.
 * ⚠ The other-sport waiver check's morning window can overlap the NFL's Tuesday one; each still
 * gets at most this much, and both stop starting users at the ceiling below.
 *
 * ⚠ AND NEVER PAST `SWEEP_CEILING_MS` OF THE WHOLE RUN. The fast-tier runner gives this route
 * 330s. Measured over three days (2026-09-21..24): the sweep alone ran p50 24s, p95 40s — and once
 * 288s. After a run like that a check gets nothing and starts no one; they are picked up
 * 15 minutes later rather than pushing the request past its client's timeout.
 */
const WEEKLY_CHECK_BUDGET_MS = 90_000
const SWEEP_CEILING_MS = 240_000

type PhaseRefusal = { ran: false; reason: 'disabled' | 'error'; error?: string }
type LineupCheckReport = LineupCheckRun | PhaseRefusal
type BestBallDepthReport = BestBallDepthRun | PhaseRefusal
type SlateLockReport = SlateLockRun | PhaseRefusal
type FollowFreeAgentReport = FollowFreeAgentRun | PhaseRefusal
type WaiverCheckReport = WaiverCheckRun | PhaseRefusal
type SportWaiverCheckReport = SportWaiverCheckRun | PhaseRefusal
type ChopReleaseReport = ChopReleaseRun | PhaseRefusal
type ScheduledAnnouncementsReport = ScheduledAnnouncementRun | PhaseRefusal
type DeadlineAutopilotReport = AutopilotRun | PhaseRefusal
type StorylineAutoPostReport = AutoPostRun | PhaseRefusal

type PhaseArgs = {
  mode: string
  dryRun: boolean
  singleUser: string | null
  /** When the whole sweep started, so the check's budget shrinks with what the sweep used. */
  sweepStartedAt: number
}

/**
 * One weekly check, run so that it can never fail the sweep it rides on, and recorded only when it
 * actually ran for users on a scheduled fire — hand-run verifications record nothing, for the
 * reason the sweep's own heartbeat gives below.
 */
async function weeklyCheckPhase<R extends { ran: boolean }>(
  name: string,
  args: PhaseArgs,
  run: (opts: { dryRun: boolean; force: boolean; userId: string | null; budgetMs: number }) => Promise<R>,
  heartbeat: (result: Extract<R, { ran: true }>) => { jobName: string; outcome: Parameters<typeof recordSyncJobRun>[1] },
  /** The heartbeat row's sport; null for a check spanning several. */
  sport: string | null = 'NFL',
): Promise<R | PhaseRefusal> {
  if (args.mode === 'off' || args.mode === '0') return { ran: false, reason: 'disabled' }
  const force = args.mode === 'force'
  const started = Date.now()
  try {
    const result = await run({
      dryRun: args.dryRun,
      force,
      userId: args.singleUser,
      budgetMs: Math.max(0, Math.min(WEEKLY_CHECK_BUDGET_MS, SWEEP_CEILING_MS - (Date.now() - args.sweepStartedAt))),
    })
    if (result.ran && !args.dryRun && !args.singleUser && !force) {
      const hb = heartbeat(result as Extract<R, { ran: true }>)
      await recordSyncJobRun({ jobName: hb.jobName, sport, trigger: 'cron' }, hb.outcome, Date.now() - started)
    }
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 160) : String(err).slice(0, 160)
    console.error(`[cron/alert-sweep] ${name} failed:`, message)
    return { ran: false, reason: 'error', error: message }
  }
}

function lineupCheckPhase(args: PhaseArgs): Promise<LineupCheckReport> {
  return weeklyCheckPhase('lineup check', args, runLineupCheck, (r) => ({
    jobName: LINEUP_CHECK_JOB,
    outcome: {
      rowsRead: r.leaguesChecked,
      rowsWritten: r.outcomes.sent ?? 0,
      rowsSkipped: r.notReached,
      errors: r.errors.map((e) => `${e.userId}: ${e.error}`),
      status: r.errors.length > 0 ? 'partial' : 'success',
      metadata: { week: r.week, mainSlate: r.mainSlate, users: r.users, outcomes: r.outcomes },
    },
  }))
}

/**
 * ⚠ SHARES THE LINEUP CHECK'S WINDOW, so the two run in the same fires; each has its own budget and
 * both still stop starting users at `SWEEP_CEILING_MS`. Only managers holding a best ball league are
 * walked, so for most of the audience this costs nothing.
 */
function bestBallDepthPhase(args: PhaseArgs): Promise<BestBallDepthReport> {
  return weeklyCheckPhase('best ball depth check', args, runBestBallDepthCheck, (r) => ({
    jobName: BEST_BALL_DEPTH_JOB,
    outcome: {
      rowsRead: r.leaguesChecked,
      rowsWritten: r.outcomes.sent ?? 0,
      rowsSkipped: r.notReached,
      errors: r.errors.map((e) => `${e.userId}: ${e.error}`),
      status: r.errors.length > 0 ? 'partial' : 'success',
      metadata: { week: r.week, mainSlate: r.mainSlate, users: r.users, outcomes: r.outcomes },
    },
  }))
}

/**
 * Runs before every non-main slate (Thursday, Sunday night, Monday). Never inside the lineup check's
 * window, which is the main slate's, so the two do not share a run's budget.
 */
function slateLockPhase(args: PhaseArgs): Promise<SlateLockReport> {
  return weeklyCheckPhase('slate lock check', args, runSlateLockCheck, (r) => ({
    jobName: SLATE_LOCK_JOB,
    outcome: {
      rowsRead: r.leaguesChecked,
      rowsWritten: r.outcomes.sent ?? 0,
      rowsSkipped: r.notReached,
      errors: r.errors.map((e) => `${e.userId}: ${e.error}`),
      status: r.errors.length > 0 ? 'partial' : 'success',
      metadata: { week: r.week, slate: r.slate, users: r.users, outcomes: r.outcomes },
    },
  }))
}

/**
 * Followed players who just went from a roster to nobody's in one of your leagues (2026-10-08, the
 * Finder's "Alert me"). Every sweep, not a weekly window: a drop can land any day and is worth most
 * in the first hour. A transition alert — the first run per follow only writes its baseline.
 */
function followFreeAgentPhase(args: PhaseArgs): Promise<FollowFreeAgentReport> {
  return weeklyCheckPhase(
    'follow free-agent check',
    args,
    (o) => runFollowFreeAgentCheck({ dryRun: o.dryRun, userId: o.userId, budgetMs: o.budgetMs }, followFreeAgentDeps),
    (r) => ({
      jobName: FOLLOW_FREE_AGENT_JOB,
      outcome: {
        rowsRead: r.followsChecked,
        rowsWritten: r.alerts,
        rowsSkipped: r.notReached,
        errors: r.errors.map((e) => `${e.userId}: ${e.error}`),
        status: r.errors.length > 0 ? 'partial' : 'success',
        metadata: { users: r.users, seeded: r.seeded, deduped: r.deduped },
      },
    }),
  )
}

function waiverCheckPhase(args: PhaseArgs): Promise<WaiverCheckReport> {
  return weeklyCheckPhase('waiver check', args, runWaiverCheck, (r) => ({
    jobName: WAIVER_CHECK_JOB,
    outcome: {
      rowsRead: r.users,
      rowsWritten: r.outcomes.sent ?? 0,
      rowsSkipped: r.notReached,
      errors: r.errors.map((e) => `${e.userId}: ${e.error}`),
      status: r.errors.length > 0 ? 'partial' : 'success',
      metadata: { week: r.week, firstKickoff: r.firstKickoff, users: r.users, picks: r.picks, outcomes: r.outcomes },
    },
  }))
}

function sportWaiverCheckPhase(args: PhaseArgs): Promise<SportWaiverCheckReport> {
  return weeklyCheckPhase(
    'sport waiver check',
    args,
    runSportWaiverCheck,
    (r) => ({
      jobName: SPORT_WAIVER_CHECK_JOB,
      outcome: {
        rowsRead: r.users,
        rowsWritten: r.outcomes.sent ?? 0,
        rowsSkipped: r.notReached,
        errors: r.errors.map((e) => `${e.userId}: ${e.error}`),
        status: r.errors.length > 0 ? 'partial' : 'success',
        metadata: { day: r.day, sports: r.sports, openSports: r.openSports, users: r.users, picks: r.picks, outcomes: r.outcomes },
      },
    }),
    null,
  )
}

/**
 * 🛑 THE FLAG IS READ HERE, BEFORE THE RUNNER IS EVEN LOADED — and again inside it. Off, the sweep
 * never imports the plan code or touches a guillotine league. `chopReleaseEnabled` is pure.
 */
async function chopReleasePhase(args: PhaseArgs): Promise<ChopReleaseReport> {
  if (!chopReleaseEnabled()) return { ran: false, reason: 'disabled' }
  return weeklyCheckPhase(
    'chop-release alert',
    args,
    async (opts) => (await import('@/lib/chimmy-alerts/runChopReleaseCheck')).runChopReleaseCheck(opts),
    (r) => ({
      jobName: CHOP_RELEASE_JOB,
      outcome: {
        rowsRead: r.leagues,
        rowsWritten: r.outcomes.sent ?? 0,
        rowsSkipped: r.noWeek,
        errors: r.errors.map((e) => `${e.userId}@${e.leagueId}: ${e.error}`),
        status: r.errors.length > 0 ? 'partial' : 'success',
        metadata: { chops: r.chops, outcomes: r.outcomes, budgetStopped: r.budgetStopped, seeded: r.seeded, resets: r.resets },
      },
    }),
  )
}

/** Scheduled league announcements whose time has come. The heartbeat is written only when one moved. */
async function scheduledAnnouncementsPhase(args: PhaseArgs): Promise<ScheduledAnnouncementsReport> {
  if (args.mode === 'off' || args.mode === '0') return { ran: false, reason: 'disabled' }
  const started = Date.now()
  try {
    const { runScheduledAnnouncements } = await import('@/lib/commissioner/scheduledAnnouncementService')
    const r = await runScheduledAnnouncements({ dryRun: args.dryRun, budgetMs: SCHEDULED_ANNOUNCEMENTS_BUDGET_MS })
    const moved = r.sent + r.failed + r.refused + r.staleFailed
    if (!args.dryRun && (moved > 0 || r.errors.length > 0)) {
      await recordSyncJobRun(
        { jobName: SCHEDULED_ANNOUNCEMENTS_JOB, sport: null, trigger: 'cron' },
        {
          rowsRead: r.leagues,
          rowsWritten: r.sent,
          rowsSkipped: r.refused,
          errors: r.errors.map((e) => `${e.leagueId}: ${e.error}`),
          status: r.errors.length > 0 || r.failed > 0 || r.staleFailed > 0 ? 'partial' : 'success',
          metadata: { failed: r.failed, staleFailed: r.staleFailed, budgetStopped: r.budgetStopped },
        },
        Date.now() - started,
      )
    }
    return r
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 160) : String(err).slice(0, 160)
    console.error('[cron/alert-sweep] scheduled announcements failed:', message)
    return { ran: false, reason: 'error', error: message }
  }
}

/** The Storyline Studio auto-post. The heartbeat is written only when something posted or failed. */
async function storylineAutoPostPhase(args: PhaseArgs): Promise<StorylineAutoPostReport> {
  if (args.mode === 'off' || args.mode === '0') return { ran: false, reason: 'disabled' }
  if (String(process.env.STORYLINE_AUTOPOST ?? '').trim().toLowerCase() === 'off') return { ran: false, reason: 'disabled' }
  const started = Date.now()
  try {
    const { runStorylineAutoPost } = await import('@/lib/storyline-studio/storylineService')
    const r = await runStorylineAutoPost({
      dryRun: args.dryRun,
      budgetMs: Math.max(0, Math.min(STORYLINE_AUTOPOST_BUDGET_MS, SWEEP_CEILING_MS - (Date.now() - args.sweepStartedAt))),
    })
    if (!args.dryRun && (r.posted > 0 || r.errors.length > 0)) {
      await recordSyncJobRun(
        { jobName: STORYLINE_AUTOPOST_JOB, sport: null, trigger: 'cron' },
        {
          rowsRead: r.leagues,
          rowsWritten: r.posted,
          rowsSkipped: r.notDue + r.notEntitled + r.refused + r.nothingToSay + r.alreadyPosted,
          errors: r.errors.map((e) => `${e.leagueId}: ${e.error}`),
          status: r.errors.length > 0 ? 'partial' : 'success',
          metadata: { notEntitled: r.notEntitled, refused: r.refused, nothingToSay: r.nothingToSay, budgetStopped: r.budgetStopped },
        },
        Date.now() - started,
      )
    }
    return r
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 160) : String(err).slice(0, 160)
    console.error('[cron/alert-sweep] storyline auto-post failed:', message)
    return { ran: false, reason: 'error', error: message }
  }
}

/**
 * 🛑 THE FLAG IS READ HERE, BEFORE THE SERVICE IS LOADED. Off, the sweep never touches a league.
 * The heartbeat is recorded only when reminders went out — an idle run every five minutes is noise.
 */
async function deadlineAutopilotPhase(args: PhaseArgs): Promise<DeadlineAutopilotReport> {
  if (process.env.DEADLINE_AUTOPILOT_ENABLED !== '1') return { ran: false, reason: 'disabled' }
  if (args.mode === 'off' || args.mode === '0') return { ran: false, reason: 'disabled' }
  const started = Date.now()
  try {
    const { runDeadlineAutopilot } = await import('@/lib/deadline-autopilot/autopilotService')
    const r = await runDeadlineAutopilot({
      dryRun: args.dryRun,
      budgetMs: Math.max(0, Math.min(WEEKLY_CHECK_BUDGET_MS, SWEEP_CEILING_MS - (Date.now() - args.sweepStartedAt))),
    })
    if (!args.dryRun && (r.reminders > 0 || r.errors.length > 0)) {
      await recordSyncJobRun(
        { jobName: DEADLINE_AUTOPILOT_JOB, sport: null, trigger: 'cron' },
        {
          rowsRead: r.leagues,
          rowsWritten: r.reminders,
          rowsSkipped: r.notEntitled,
          errors: r.errors.map((e) => `${e.leagueId}: ${e.error}`),
          status: r.errors.length > 0 ? 'partial' : 'success',
          metadata: { recipients: r.recipients, budgetStopped: r.budgetStopped },
        },
        Date.now() - started,
      )
    }
    return r
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 160) : String(err).slice(0, 160)
    console.error('[cron/alert-sweep] deadline autopilot failed:', message)
    return { ran: false, reason: 'error', error: message }
  }
}

/**
 * Game-window Sleeper status fold.
 *
 * `SleeperStatusAdapter` and the playerGameLock engine otherwise run only in
 * the AutoCoach worker, which nothing schedules — so this sweep's
 * injured-starter detection ran purely on the 15-minute Rolling Insights
 * ingest. This folds a bounded read of Sleeper's live `injury_status` blob
 * into `SportsInjury` (source `sleeper_live`, short TTL) so the canonical
 * injury read port — the sweep's actual injury source via
 * `assembleCrossLeaguePlayerPortfolio` → `resolveInjuryFacts` — sees fresh
 * game-day designations: the port picks the freshest row per player, so a
 * just-fetched live status wins for the rest of the window and expires on
 * its own afterwards.
 *
 * Bounded on purpose: NFL only (the sweep hydrates NFL), Out/Doubtful only
 * (the designations that actually move inside a game window — IR and
 * suspensions are slow-moving and already carried by the RI ingest), capped
 * row count, no-op outside game windows, and the adapter caches the blob.
 */
const LIVE_FOLD_TIMEOUT_MS = 8_000
const LIVE_FOLD_MAX_ROWS = 400
const LIVE_STATUS_TTL_MS = 6 * 60 * 60 * 1000
const LIVE_STATUS_SOURCE = 'sleeper_live'
const LIVE_URGENT_STATUSES = new Set(['out', 'doubtful'])
const GAME_WINDOW_HOURS = 8

async function foldLiveSleeperStatusesForGameWindow(now: Date): Promise<void> {
  const gamesInWindow = await prisma.sportsGame.count({
    where: {
      sport: 'NFL',
      startTime: {
        gte: new Date(now.getTime() - GAME_WINDOW_HOURS * 60 * 60 * 1000),
        lte: new Date(now.getTime() + GAME_WINDOW_HOURS * 60 * 60 * 1000),
      },
    },
  })
  if (gamesInWindow === 0) return

  const statuses = await fetchSleeperStatuses('nfl')
  const urgentIds = [...statuses]
    .filter(([, status]) => LIVE_URGENT_STATUSES.has(status.trim().toLowerCase()))
    .map(([sleeperId]) => sleeperId)

  /*
   * 🛑 NAME THE SLEEPER ID BY `sleeperId` / `sleeper:<id>`, NEVER BY BARE
   * `externalId` — that column is each provider's own id, and this lookup used to
   * hand Sleeper 8394's "Out" (Percy Butler) to Rolling Insights 8394 (Rome
   * Odunze). See `sleeperIdentities`.
   */
  const identityRows =
    urgentIds.length > 0
      ? await prisma.sportsPlayer.findMany({
          where: sleeperIdWhere(urgentIds, 'NFL'),
          orderBy: { updatedAt: 'desc' },
          select: { externalId: true, sleeperId: true, source: true, name: true, team: true, position: true },
        })
      : []
  const plan = planLiveFold(
    statuses,
    sleeperIdentities(urgentIds, identityRows),
    LIVE_URGENT_STATUSES,
    LIVE_FOLD_MAX_ROWS,
  )

  // A player who recovered must not keep an old live row outranking the feed —
  // clear every live row this pass does not rewrite: no longer urgent, or no
  // longer nameable. Run AFTER naming, so a row filed under the wrong player
  // cannot outlive the pass that stops vouching for it.
  await prisma.sportsInjury.deleteMany({
    where: {
      sport: 'NFL',
      source: LIVE_STATUS_SOURCE,
      ...(plan.length > 0 ? { externalId: { notIn: plan.map((u) => u.sleeperId) } } : {}),
    },
  })
  if (plan.length === 0) return

  const expiresAt = new Date(now.getTime() + LIVE_STATUS_TTL_MS)

  /*
   * ⚠ `date` IS WHEN WE FIRST SAW THE WORD, KEPT ACROSS RE-FOLDS. This loop
   * runs every five minutes and used to leave `date` empty, so nothing could
   * tell a Friday Out from a scratch announced ninety minutes before kickoff
   * — the pregame inactive (lib/core-app/pregameInactive.ts). The instant is
   * preserved while the designation holds and reset when it changes
   * (liveStatusFold.ts); the card reads the earliest report of the current
   * word across every source (designationOnset.ts), so a Friday ruling still
   * shows Friday when ESPN carries it.
   */
  const existingLive = await prisma.sportsInjury.findMany({
    where: { sport: 'NFL', source: LIVE_STATUS_SOURCE, externalId: { in: plan.map((u) => u.sleeperId) } },
    select: { externalId: true, status: true, date: true, expiresAt: true },
  })
  const existingById = new Map(existingLive.map((e) => [e.externalId, e]))

  for (const u of plan) {
    const date = liveFirstSeen(existingById.get(u.sleeperId), u.status, now)
    await prisma.sportsInjury.upsert({
      where: {
        sport_externalId_source: { sport: 'NFL', externalId: u.sleeperId, source: LIVE_STATUS_SOURCE },
      },
      create: {
        sport: 'NFL',
        externalId: u.sleeperId,
        playerName: u.name,
        playerId: u.sleeperId,
        team: u.team,
        position: u.position,
        status: u.status,
        date,
        source: LIVE_STATUS_SOURCE,
        fetchedAt: now,
        expiresAt,
      },
      update: {
        playerName: u.name,
        team: u.team,
        position: u.position,
        status: u.status,
        date,
        fetchedAt: now,
        expiresAt,
      },
    })
  }
}

interface SweepUserResult {
  userId: string
  injuredStarters: number
  alerts: number
  pushed: number
  /** True when today's message about this player and designation had already gone out. */
  deduped: boolean
  /**
   * Why the push was withheld by the user's own settings (pushGate reason), when it was. Not an
   * error: a muted league or quiet hours is the setting working.
   */
  pushSkipped?: string
  /** Every detected alert was muted in Chimmy's alert controls (class, type or league). */
  mutedByChimmyPrefs?: boolean
  /** Players named in this sweep's message — more than one is the game-day digest. */
  playersSent?: number
  /** Final-call messages (the one injury alert that may text) dispatched this sweep. */
  finalCalls?: number
  errors: string[]
}

async function handle(req: NextRequest) {
  const url = new URL(req.url)
  const dryRun = ['1', 'true', 'yes'].includes((url.searchParams.get('dryRun') ?? '').toLowerCase())
  const singleUser = url.searchParams.get('userId')
  const limitParam = Number(url.searchParams.get('limit'))
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.floor(limitParam) : 200

  const startedAt = Date.now()
  // Either transport is enough: sendPushToUser routes iPhones to APNs and browsers to web-push,
  // each on its own keys. Gating on VAPID alone skipped every iPhone-only user whenever web
  // push was unset, and reported the run as "push not configured" while APNs was live.
  const pushConfigured =
    Boolean(process.env.VAPID_PUBLIC_KEY?.trim() && process.env.VAPID_PRIVATE_KEY?.trim()) ||
    apnsConfig() !== null

  const runSweep = async () => {
    // Scheduled announcements first: cheap, and the one job a person is waiting on (see the header).
    const scheduledAnnouncements = singleUser
      ? ({ ran: false, reason: 'disabled' } as const)
      : await scheduledAnnouncementsPhase({
          mode: (url.searchParams.get('scheduledAnnouncements') ?? '').trim().toLowerCase(),
          dryRun,
          singleUser,
          sweepStartedAt: startedAt,
        })

    // The Storyline Studio auto-post, right after: also a commissioner's chosen time.
    const storylineAutoPost = singleUser
      ? ({ ran: false, reason: 'disabled' } as const)
      : await storylineAutoPostPhase({
          mode: (url.searchParams.get('storylineAutoPost') ?? '').trim().toLowerCase(),
          dryRun,
          singleUser,
          sweepStartedAt: startedAt,
        })

    // Game-window fold FIRST, so this very sweep evaluates against the fresh
    // statuses. Error-swallowed and time-boxed: Sleeper being slow or down must
    // never stop the sweep itself (the race leaves a late fold to finish in the
    // background; the sweep proceeds on whatever the port already has).
    await Promise.race([
      foldLiveSleeperStatusesForGameWindow(new Date()).catch((err) => {
        console.warn(
          '[cron/alert-sweep] live status fold skipped:',
          err instanceof Error ? err.message : String(err),
        )
      }),
      new Promise<void>((resolve) => setTimeout(resolve, LIVE_FOLD_TIMEOUT_MS)),
    ])

    // Push subscribers first (both channels), then everyone with a claimed team this season —
    // email is the channel that exists (see the header). The dispatcher gates each of them.
    const season = new Date().getUTCFullYear()
    const [pushSubscribers, claimed] = singleUser
      ? [[], []]
      : await Promise.all([
          prisma.webPushSubscription.findMany({ select: { userId: true }, distinct: ['userId'], take: limit }),
          prisma.leagueTeam.findMany({
            /*
             * season + 1 since every sport joined the sweep (2026-10-08): ESPN stores an NBA/NHL
             * 2026-27 league as 2027, so a manager whose only team is one of those was outside the
             * audience. Which of their leagues count is gameDayScope.isCurrentSeasonLeague's call.
             */
            where: { claimedByUserId: { not: null }, league: { season: { in: [season, season + 1] } } },
            select: { claimedByUserId: true },
            distinct: ['claimedByUserId'],
            take: limit,
          }),
        ])
    const subscribers = singleUser
      ? [{ userId: singleUser }]
      : mergeAudience(
          pushSubscribers.map((s) => s.userId),
          claimed.map((c) => c.claimedByUserId).filter((id): id is string => Boolean(id)),
          limit,
        ).map((userId) => ({ userId }))

    // Reported beside usersScanned so a verification reads the union and the contact gate
    // apart (see the header). The same column the dispatcher's profile read gates on (the
    // column is NOT NULL, so "none on file" is the empty string); the undeliverable-domain
    // rule is stricter still, so this is an upper bound on sends.
    const usersWithEmail = await prisma.appUser
      .count({ where: { id: { in: subscribers.map((s) => s.userId) }, email: { not: '' } } })
      .catch(() => null)

    const teamWorkspace = dryRun ? { dryRun: true } : await (await import('@/lib/core-app/teamWorkspaceSweep')).runTeamWorkspaceSweep(subscribers.map(s => s.userId), Math.min(Date.now() + 30_000, startedAt + SWEEP_CEILING_MS)).catch(() => ({ errors: 1 }))

    const results: SweepUserResult[] = []
    let totalPushed = 0
    let totalAlerts = 0
    let totalDeduped = 0
    let totalPushSkipped = 0
    let totalMutedByChimmy = 0

    for (const sub of subscribers) {
      const result: SweepUserResult = { userId: sub.userId, injuredStarters: 0, alerts: 0, pushed: 0, deduped: false, errors: [] }
      try {
        /*
         * EVERY SPORT, not only the NFL (Guap, 2026-10-08: "do the same for all game days for all
         * sports"). `sport: null` reads every sport's current leagues; gameDayScope.onGameDay keeps
         * the NFL exactly as it was and lets a daily sport speak only when his game starts within
         * GAME_DAY_HOURS. INJURY_ALERTS_NFL_ONLY=1 puts it back to the NFL without a deploy.
         */
        const hydrated = await hydrateInjuredStarters({ appUserId: sub.userId, sport: allSportsInjuryAlertsEnabled() ? null : 'NFL' })
        const sweepNow = new Date()
        const signal = { ...hydrated, injuredStarters: hydrated.injuredStarters.filter((s) => onGameDay(s, sweepNow)) }
        result.injuredStarters = signal.injuredStarters.length
        if (signal.injuredStarters.length === 0) {
          results.push(result)
          continue
        }

        // `lineupLockAt` is intentionally left undefined for now: no durable per-league lock
        // time is populated yet. The detector handles that by scoring at a lower, non-zero
        // urgency rather than refusing — a manager should still be told his starter is out
        // even when we cannot say exactly how long he has.
        const context = {
          now: new Date(),
          signalBundle: { injuredStarters: signal.injuredStarters },
        } as unknown as ChimmyAlertContext

        const detected = detectInjuredStarterAlerts(context)
        result.alerts = detected.length
        totalAlerts += detected.length
        if (detected.length === 0) {
          results.push(result)
          continue
        }

        /*
         * 🛑 CHIMMY'S OWN MUTE SWITCHES APPLY HERE TOO. These alerts are class `lineup`, and the
         * Settings panel's "Lineup" mute (or a muted type or league) was read only by the alert
         * ENGINE — which this sweep does not run. So a manager who muted Chimmy's lineup alerts
         * still got these. Filtered before `top` is chosen, so a muted league cannot silence an
         * alert about another one. A preferences read that fails mutes nothing: the category
         * switch in the dispatcher still applies.
         */
        const chimmyPrefs = await loadChimmyAlertPreferences(sub.userId).catch(() => null)
        const alerts = detected.filter((a) => !preferenceMuteReason(a, chimmyPrefs))
        if (alerts.length === 0) {
          result.mutedByChimmyPrefs = true
          totalMutedByChimmy += 1
          results.push(result)
          continue
        }

        if (dryRun) {
          results.push(result)
          continue
        }

        // Settings › Notifications › Player news "Off" silences these too (playerNewsLevel.ts).
        if ((await readPlayerNewsLevelFor(sub.userId)) === 'off') {
          results.push(result)
          continue
        }

        /*
         * ONE message per player covering EVERY league he starts in (the injury fan-out,
         * injuryFanOutCopy.ts) — and, since 2026-10-08, ONE phone notification for EVERY player not
         * yet told about today: the game-day digest. Guap's ask: when the inactives land, one
         * notification with the list of who is out and the leagues to fix.
         *
         * 🛑 BEFORE THE DIGEST THIS SENT THE FIRST UNSENT PLAYER AND STOPPED. Three starters ruled
         * out at 11:30 on a Sunday took three sweeps — 45 minutes, three buzzes — to say one thing,
         * and the third could land after a 1pm lock. Every unsent player is now said in this sweep.
         *
         * Each player still gets his OWN in-app row under his own dedupe key: the bell lists them
         * one by one, and that row's sourceKey is what tells the next sweep he was already said.
         * The email rides the first row only and lists everyone; the phone gets one push.
         */
        const now = new Date()
        const groups = groupAlertsByPlayer(alerts)
        const unsent: Array<{ group: (typeof alerts)[number][]; key: string }> = []
        /*
         * 📱 THE ONE INJURY ALERT THAT TEXTS (2026-10-17; the A2P 10DLC sender is approved, owner
         * signed off). Within ~3h of lock (urgency ≥ 78) a starter still ruled out and still in the
         * lineup is worth an SMS — once per player, designation and Eastern day:
         *   - first seen inside the window → the REGULAR row carries the text (the digest push and
         *     email stay exactly as they were), and that row is stamped `meta.texted`;
         *   - already told earlier that day → a separate FINAL CALL row (`<key>:final`) with a push
         *     and the text, so the morning heads-up never uses up the near-lock text.
         * Several players in one sweep share ONE text. Everything else about the text is the
         * dispatcher's: SMS consent, the injury_alerts SMS switch, quiet hours (high severity
         * passes only for users who allow critical alerts) and the per-user daily cap.
         * `INJURY_ALERTS_SMS=off` turns all of it off without a deploy.
         */
        const smsOn = injurySmsEnabled()
        const nearLock = (g: (typeof alerts)[number][]) => smsOn && g[0]!.urgencySignal >= 78
        const finalCalls: Array<{ group: (typeof alerts)[number][]; key: string }> = []
        for (const g of groups) {
          const key = injuredStarterDedupeKey(g[0]!, now)
          // Today's message about this player and designation already went out: say nothing again —
          // unless it went out before the lock window and the final call has not been made.
          const already = await prisma.platformNotification
            .findFirst({ where: { sourceKey: `${key}:${sub.userId}` }, select: { id: true, meta: true } })
            .catch(() => null)
          if (!already) {
            unsent.push({ group: g, key })
            continue
          }
          if (!nearLock(g) || (already.meta as { texted?: boolean } | null)?.texted === true) continue
          const finalKey = `${key}:final`
          const finalSaid = await prisma.platformNotification
            .findFirst({ where: { sourceKey: `${finalKey}:${sub.userId}` }, select: { id: true } })
            .catch(() => null)
          if (!finalSaid) finalCalls.push({ group: g, key: finalKey })
        }
        if (finalCalls.length > 0) {
          const fanOutsF = await Promise.all(finalCalls.map((f) => buildFanOutLeagues(sub.userId, f.group, now).catch(() => [])))
          const copiesF = finalCalls.map((f, i) => fanOutCopy(f.group, fanOutsF[i]!))
          const hrefsF = await Promise.all(finalCalls.map(async (f) => injuredStarterHref(f.group[0]!, await alertPlayerRef(f.group[0]!).catch(() => null))))
          // One text for all of them: his own copy and card for one player, the digest for several.
          const smsBody =
            finalCalls.length === 1
              ? finalCallSms(copiesF[0]!, `${getBaseUrl()}${hrefsF[0]!}`)
              : finalCallSms(digestCopy(finalCalls.map((f) => f.group)), `${getBaseUrl()}/core/players`)
          for (let i = 0; i < finalCalls.length; i++) {
            const f = finalCalls[i]!
            await dispatchNotification({
              userIds: [sub.userId],
              category: 'injury_alerts',
              productType: 'app',
              type: 'chimmy_alert',
              title: `Final call: ${copiesF[i]!.title}`,
              body: copiesF[i]!.body,
              actionHref: hrefsF[i]!,
              actionLabel: 'Open his card',
              leagueId: f.group[0]!.leagueId ?? null,
              severity: 'high',
              meta: { chimmyAlert: true, finalCall: true, class: f.group[0]!.class, alertType: f.group[0]!.type, ...(f.group[0]!.metadata ?? {}) },
              dedupePrefix: f.key,
              // The morning email already said it. The text rides the first row only.
              skipChannels: { email: true, sms: i !== 0 },
              ...(i === 0 ? { smsBody } : {}),
            }).catch(() => undefined)
          }
        }
        result.finalCalls = finalCalls.length
        if (unsent.length === 0) {
          result.deduped = finalCalls.length === 0
          totalDeduped += 1
          results.push(result)
          continue
        }
        // The backup to start in each league (the finder's league-scored picker) and where to fix it, per player.
        const fanOuts = await Promise.all(unsent.map((u) => buildFanOutLeagues(sub.userId, u.group, now).catch(() => [])))
        const copies = unsent.map((u, i) => fanOutCopy(u.group, fanOuts[i]!))
        const hrefs = await Promise.all(unsent.map(async (u) => injuredStarterHref(u.group[0]!, await alertPlayerRef(u.group[0]!))))
        const severityOf = (u: (typeof unsent)[number]): 'high' | 'medium' => (u.group[0]!.urgencySignal >= 78 ? 'high' : 'medium')

        /*
         * The email lists EVERY flagged player, not just the ones this sweep sends about. The
         * players sent now carry their per-league fix links; the others say what the detector said.
         */
        const injuryEmail = renderInjuryEmail({
          alerts: groups.map((g) => {
            const i = unsent.findIndex((u) => u.group === g)
            if (i >= 0) {
              return {
                title: copies[i]!.title,
                message: copies[i]!.body,
                leagueId: g[0]!.leagueId ?? null,
                // Each league's lineup screen, and — where no bench player can come in — its claim screen,
                // named for the free agent when one was picked (injuryFanOut.ts, 2026-10-09).
                fixLinks: fanOuts[i]!.flatMap((l) => [
                  ...(l.fixHref ? [{ leagueName: l.leagueName, href: l.fixHref }] : []),
                  ...(l.claimHref
                    ? [{ leagueName: l.leagueName, href: l.claimHref, label: l.freeAgent ? `Add ${l.freeAgent.name} in ${l.leagueName}` : `Free agents in ${l.leagueName}` }]
                    : []),
                ]),
              }
            }
            const other = fanOutCopy(g, [])
            return { title: other.title, message: other.body, leagueId: g[0]!.leagueId ?? null }
          }),
          baseUrl: getBaseUrl(),
        })

        /*
         * In-app rows first, so the bell and the notifications centre carry the
         * alert even when push is unconfigured or the subscription has gone
         * stale. The Eastern-day bucket in the dedupe prefix keeps a 15-minute
         * cadence from writing 96 rows for the same injury.
         *
         * Email rides `emailOverride` deliberately. The dispatcher's default
         * sender strips its own HTML — every tag replaced with a space — so
         * anything designed must come through the override, which is the only
         * path to sendTemplatedEmail. SMS and push stay skipped here: the targeted
         * push below is the only push, and the one alert that texts is the
         * FINAL CALL near lock (see `finalCalls` above), so the morning heads-up
         * never spends a text.
         */
        // Players first told about inside the lock window: their rows carry ONE shared text.
        const textNow = unsent.map((u, i) => (nearLock(u.group) ? i : -1)).filter((i) => i >= 0)
        const textBody =
          textNow.length === 0
            ? null
            : textNow.length === 1
              ? finalCallSms(copies[textNow[0]!]!, `${getBaseUrl()}${hrefs[textNow[0]!]!}`)
              : finalCallSms(digestCopy(textNow.map((i) => unsent[i]!.group)), `${getBaseUrl()}/core/players`)
        for (let i = 0; i < unsent.length; i++) {
          const u = unsent[i]!
          const top = u.group[0]!
          // At most ONE of these designed emails per person per Eastern day (owner's call, 2026-10-22):
          // later sweeps that day push and write the bell; the daily roster digest carries the rest.
          const withEmail = i === 0 && injuryEmail != null && (await claimPlayerNewsEmailToday(sub.userId, now))
          const texts = textBody != null && i === textNow[0]
          const covered = textNow.includes(i)
          await dispatchNotification({
            userIds: [sub.userId],
            category: 'injury_alerts',
            productType: 'app',
            type: 'chimmy_alert',
            title: copies[i]!.title,
            body: copies[i]!.body,
            // The Player Finder card: it leads with the game-day banner and the verified lineup buttons.
            actionHref: hrefs[i]!,
            actionLabel: 'Open his card',
            leagueId: top.leagueId ?? null,
            severity: severityOf(u),
            // `texted` tells a later sweep the near-lock text for this player already went out.
            meta: { chimmyAlert: true, class: top.class, alertType: top.type, ...(top.metadata ?? {}), ...(covered ? { texted: true } : {}) },
            dedupePrefix: u.key,
            skipChannels: { email: !withEmail, sms: !texts, push: true },
            ...(texts && textBody ? { smsBody: textBody } : {}),
            ...(withEmail && injuryEmail ? { emailOverride: injuryEmail } : {}),
          })
        }
        result.playersSent = unsent.length

        if (!pushConfigured) {
          result.errors.push('push not configured')
          results.push(result)
          continue
        }

        /*
         * 🛑 THE PHONE FOLLOWS THE USER'S SETTINGS, like the bell entry and the email above.
         * Until 2026-09-14 this push went to every subscriber: the dispatcher's category
         * switch, league mute and quiet hours withheld the in-app row and the email, and
         * this line buzzed the phone regardless. pushGate holds the dispatcher's own rule.
         * A high-severity alert passes quiet hours only when the user allows critical
         * alerts (user decision, 2026-09-14). A settings read that fails sends nothing.
         *
         * Asked per player: a league the user muted keeps its player out of the digest
         * without silencing the others.
         */
        const gates = await Promise.all(
          unsent.map((u) =>
            decidePushForUser(sub.userId, {
              category: 'injury_alerts',
              leagueId: u.group[0]!.leagueId ?? null,
              severity: severityOf(u),
            }).catch(() => null),
          ),
        )
        const pushable = unsent.map((u, i) => ({ u, i })).filter(({ i }) => gates[i]?.allowed)
        if (pushable.length === 0) {
          const first = gates[0]
          result.pushSkipped = first && !first.allowed ? first.reason : 'settings_unavailable'
          totalPushSkipped += 1
          results.push(result)
          continue
        }

        // One player: his own fan-out copy and card. Several: the digest, landing on the finder's
        // game-day list ("Game day · your flagged starters"), which shows every one with its lock.
        const single = pushable.length === 1 ? pushable[0]! : null
        const pushCopy = single ? copies[single.i]! : digestCopy(pushable.map(({ u }) => u.group))
        const sent = await sendPushToUser(sub.userId, {
          title: pushCopy.title,
          body: pushCopy.body,
          href: single ? hrefs[single.i]! : '/core/players',
          tag: pushable[0]!.u.key,
          type: 'lineup',
          leagueId: single ? (single.u.group[0]!.leagueId ?? null) : null,
        })
        const okCount = sent.filter((s) => s.ok).length
        result.pushed = okCount
        totalPushed += okCount
        if (okCount === 0 && sent.length > 0) {
          result.errors.push(sent[0]?.error ?? 'push failed')
        }
      } catch (err) {
        result.errors.push(err instanceof Error ? err.message.slice(0, 160) : String(err))
      }
      results.push(result)
    }

    const withErrors = results.filter((r) => r.errors.length > 0)

    const lineupCheck = await lineupCheckPhase({
      mode: (url.searchParams.get('lineupCheck') ?? '').trim().toLowerCase(),
      dryRun,
      singleUser,
      sweepStartedAt: startedAt,
    })
    const bestBallDepth = await bestBallDepthPhase({
      mode: (url.searchParams.get('bestBallDepth') ?? '').trim().toLowerCase(),
      dryRun,
      singleUser,
      sweepStartedAt: startedAt,
    })
    const slateLock = await slateLockPhase({
      mode: (url.searchParams.get('slateLock') ?? '').trim().toLowerCase(),
      dryRun,
      singleUser,
      sweepStartedAt: startedAt,
    })
    const waiverCheck = await waiverCheckPhase({
      mode: (url.searchParams.get('waiverCheck') ?? '').trim().toLowerCase(),
      dryRun,
      singleUser,
      sweepStartedAt: startedAt,
    })
    const sportWaiverCheck = await sportWaiverCheckPhase({
      mode: (url.searchParams.get('sportWaiverCheck') ?? '').trim().toLowerCase(),
      dryRun,
      singleUser,
      sweepStartedAt: startedAt,
    })
    const chopRelease = await chopReleasePhase({
      mode: (url.searchParams.get('chopRelease') ?? '').trim().toLowerCase(),
      dryRun,
      singleUser,
      sweepStartedAt: startedAt,
    })
    const deadlineAutopilot = singleUser
      ? ({ ran: false, reason: 'disabled' } as const)
      : await deadlineAutopilotPhase({
          mode: (url.searchParams.get('deadlineAutopilot') ?? '').trim().toLowerCase(),
          dryRun,
          singleUser,
          sweepStartedAt: startedAt,
        })
    const followFreeAgent = await followFreeAgentPhase({
      mode: (url.searchParams.get('followFree') ?? '').trim().toLowerCase(),
      dryRun,
      singleUser,
      sweepStartedAt: startedAt,
    })

    return {
      // Zero alerts is a legitimate outcome (off-season, healthy rosters) and must not fail.
      ok: true as const,
      dryRun,
      pushConfigured,
      teamWorkspace,
      usersScanned: results.length,
      /** Audience members with a non-empty email on file; null only if the count itself failed. */
      usersWithEmail,
      usersWithInjuredStarters: results.filter((r) => r.injuredStarters > 0).length,
      alertsDetected: totalAlerts,
      usersDeduped: totalDeduped,
      pushesSent: totalPushed,
      /** Pushes the user's own settings withheld (alert type off, push off, league muted, quiet hours). */
      pushesSkippedBySettings: totalPushSkipped,
      /** Users whose every detected alert was switched off in Chimmy's alert controls. */
      usersMutedByChimmy: totalMutedByChimmy,
      usersWithErrors: withErrors.length,
      errors: withErrors.slice(0, 10).map((r) => ({ userId: r.userId, errors: r.errors })),
      /** Chimmy's lineup check — see the header. Mostly `{ ran: false, reason: 'early' }`. */
      lineupCheck,
      /** The best ball depth check — the lineup check's window; red positions only. */
      bestBallDepth,
      /** The lock check before each non-main slate — mostly `{ ran: false, reason: 'no_slate' }`. */
      slateLock,
      /** Chimmy's Tuesday waiver check — the same shape, the same rules. */
      waiverCheck,
      /** The other sports' waiver check — per-sport windows; mostly `{ ran: false, reason: 'closed' }`. */
      sportWaiverCheck,
      /** The guillotine chop-release alert — `{ ran: false, reason: 'disabled' }` until the flag is set. */
      chopRelease,
      /** Scheduled league announcements posted this run — mostly `{ leagues: 0, sent: 0 }`. */
      scheduledAnnouncements,
      /** The deadline autopilot — `{ ran: false, reason: 'disabled' }` until the flag is set. */
      deadlineAutopilot,
      /** Storyline Studio auto-posts — mostly `{ leagues: 0, posted: 0 }`. */
      storylineAutoPost,
      /** Followed players newly free in one of your leagues — `seeded` counts follows seen for the first time. */
      followFreeAgent,
      durationMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    }
  }

  try {
    /*
     * A dry run and a single-user call record NOTHING, deliberately. The probe matches on
     * job_name alone, so a row written by a hand-issued verification (`?userId=…`, which this
     * route's own docs describe as exactly that) would be indistinguishable from a scheduled
     * fire and could hide a dead scheduler. Same reasoning as cron/notification-outbox-relay.
     */
    const payload =
      dryRun || singleUser
        ? await runSweep()
        : await withSyncJobRun({ jobName: JOB, sport: 'NFL', trigger: 'cron' }, runSweep, (r) => {
            const teamWorkspace=teamSweepTelemetry(r.teamWorkspace)
            return {
              rowsRead: r.usersScanned,
              rowsWritten: r.pushesSent,
              rowsSkipped: r.usersWithErrors,
              /*
               * ⚠ ZERO PUSHES IS NOT A FAILURE and must never be recorded as one — on a Tuesday in
               * the off-season it is the correct outcome, and a job that reports failure for being
               * right is one nobody reads. What IS reported is push being unconfigured, because
               * that silently converts every alert into nothing at all.
               */
              status: !r.pushConfigured || r.usersWithErrors > 0 || teamWorkspace.errors > 0 ? ('partial' as const) : ('success' as const),
              metadata:{teamWorkspace},
            }
          })

    return NextResponse.json(payload)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[cron/alert-sweep] failed:', message)
    return NextResponse.json(
      { ok: false, error: message.slice(0, 240), durationMs: Date.now() - startedAt },
      { status: 500 },
    )
  }
}

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req, 'CRON_SECRET')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return handle(req)
}

export async function POST(req: NextRequest) {
  if (!requireCronAuth(req, 'CRON_SECRET')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return handle(req)
}

/**
 * The Player Finder ref (`NFL:<externalId>`) for the alert's player, from the Sleeper id the
 * detector carries — so the tap opens HIS card, not a name search. Null when the alert names no
 * Sleeper id (an ESPN-only player) or the catalog has no row; the href then falls back to `q=`.
 */
async function alertPlayerRef(top: { metadata?: Record<string, unknown> | null }): Promise<string | null> {
  const sleeperId = typeof top.metadata?.sleeperId === 'string' && top.metadata.sleeperId ? top.metadata.sleeperId : null
  if (!sleeperId) return null
  const sport = typeof top.metadata?.sport === 'string' && top.metadata.sport ? top.metadata.sport : 'NFL'
  const { resolvePublicPlayer } = await import('@/lib/core-app/playerFinder')
  const resolved = await resolvePublicPlayer(sport, sleeperId).catch(() => null)
  return resolved?.playerReference ?? null
}
