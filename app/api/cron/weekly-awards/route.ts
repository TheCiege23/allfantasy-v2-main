import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { AGG_PREFIX as H2H_AGG_PREFIX, getLeagueH2H } from '@/lib/league-history/sleeperH2HService'
import {
  buildWeeklyRecap,
  postWeeklyRecapAsChimmy,
  weeklyRecapAlreadyPosted,
  type WireMatchup,
  type WireRoster,
  type WireUser,
} from '@/lib/league-chat/weeklyRecapMoment'
import { getBaseUrl } from '@/lib/get-base-url'
import { withSyncJobRun } from '@/lib/production-health/syncJobRunTelemetry'
import { weeklyRecapAllowed } from '@/lib/core-app/commissioner/recipes'
import { notifyWeeklyStories } from '@/lib/core-app/weeklyStoryNotify'
import { postNativeWeeklyRecap } from '@/lib/league-chat/nativeWeeklyRecap'
import { planRecapSweep } from '@/lib/league-chat/weeklyRecapSweep'
import { notifyWeeklyRecaps, type PostedRecap } from '@/lib/league-chat/weeklyRecapNotify'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Weekly recap engine (grew out of the weekly-awards automation): once the
 * newest week exists in the H2H sync, post a full recap into league chat —
 * every matchup result, the weekly awards, any ALL-TIME records broken this
 * week, and the standings top three. Once per league per week, posted AS CHIMMY
 * through `postChimmyMoment` (lib/league-chat/weeklyRecapMoment.ts owns the words
 * and the post; this route owns the reads and the email). The row's technical
 * author is still the league owner — see lib/league-chat/chimmyIdentity.ts — but
 * every reader now shows Chimmy's name and badge instead of the commissioner's.
 *
 * Every number is counted from real matchups: results come straight from the
 * Sleeper week feed, awards/records from the same H2H aggregation the Legacy
 * tab renders. Nothing is synthesized.
 *
 * Email: when WEEKLY_RECAP_EMAIL_ENABLED=1, the recap is also emailed — ONE email per person per
 * week covering all their recapped leagues, sent with the "share it" notification through the
 * dispatcher (weeklyRecapNotify.ts / recapEmail.ts), so the results-email preference, unsubscribe and
 * undeliverable checks apply. It used to be one email per league per member, sent straight to Resend
 * past all three. We cannot email leaguemates who aren't on AllFantasy — that is what sharing is for.
 *
 * Cron: Tuesdays 14:00, 15:00 and 16:00 UTC (cron-schedule.json) — three fires so the whole sweep
 * fits; a league already recapped that week costs nothing on a later fire. Manual: a signed-in league member may pass
 * ?leagueId= to post their league's recap now (still deduped).
 */

/**
 * Never-synced leagues one fire may take (see planRecapSweep): a first head-to-head sync is one Sleeper
 * call per week of every past season, and a rate-limited one is cached with seasons missing.
 */
const COLD_LEAGUES_PER_FIRE = 40

const SLEEPER_BASE = 'https://api.sleeper.app/v1' // db-first-exception: platform feed for the week's results

async function j<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${SLEEPER_BASE}${path}`, { cache: 'no-store' })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

async function postRecapForLeague(
  afLeagueId: string,
  sleeperLeagueId: string,
  _ownerUserId: string,
  leagueName: string,
) {
  const h2h = await getLeagueH2H(sleeperLeagueId)
  const awards = h2h?.latestWeekAwards
  if (!h2h || !awards) return { posted: false, reason: 'no completed week synced yet', emailsSent: 0 }

  // Freshness guard: only recap the CURRENT NFL season. In preseason the newest
  // synced games are LAST season's — without this, the first cron fire of a new
  // season would post a stale "final week of last year" recap to every league.
  const state = await j<{ season?: string }>(`/state/nfl`)
  if (state?.season && String(state.season) !== awards.season) {
    return { posted: false, reason: `no completed week this season yet (newest synced: ${awards.season})`, emailsSent: 0 }
  }

  if (await weeklyRecapAlreadyPosted({ afLeagueId, sleeperLeagueId, season: awards.season, week: awards.week })) {
    return { posted: false, reason: 'already posted', emailsSent: 0 }
  }

  // ── Results and standings: straight from the Sleeper week feed ──
  const [rosters, users, matchups] = await Promise.all([
    j<WireRoster[]>(`/league/${sleeperLeagueId}/rosters`),
    j<WireUser[]>(`/league/${sleeperLeagueId}/users`),
    j<WireMatchup[]>(`/league/${sleeperLeagueId}/matchups/${awards.week}`),
  ])
  const text = buildWeeklyRecap({ leagueName, sleeperLeagueId, h2h, awards, rosters, users, matchups })

  /*
   * Posted as Chimmy. Deduped per league per week by the moment itself AND by the pre-Chimmy
   * `recap-posted:v1:` key (read and written — see postWeeklyRecapAsChimmy), so a week already
   * recapped under the old identity is never posted twice.
   */
  const posted = await postWeeklyRecapAsChimmy({
    afLeagueId,
    sleeperLeagueId,
    season: awards.season,
    week: awards.week,
    text,
  })
  if (!posted.posted) {
    const reason =
      posted.reason === 'duplicate' || posted.reason === 'already_posted_legacy'
        ? 'already posted'
        : posted.reason === 'disabled'
          ? 'Chimmy is switched off for this league'
          : 'chat post failed'
    return { posted: false, reason, emailsSent: 0 }
  }
  // The email is no longer sent from here — see the header: one per person per week, after the sweep.
  return { posted: true, emailsSent: 0, season: awards.season, week: awards.week, text }
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization') ?? ''
  const cronSecret = process.env.CRON_SECRET?.trim()
  const isCron = Boolean(cronSecret) && authHeader === `Bearer ${cronSecret}`

  if (isCron) {
    // Time budget: this function caps at maxDuration 300s, and a cold league's
    // first H2H sync is the expensive step. Stop walking with headroom to spare
    // and report the leftover honestly — the per-week dedupe means the next
    // fire (or a manual re-run) resumes exactly where this one stopped.
    const sweep = await withSyncJobRun(
      { jobName: 'cron-weekly-awards', trigger: 'cron' },
      async () => {
        const startedAt = Date.now()
        const TIME_BUDGET_MS = 240_000
        /*
         * EVERY Sleeper league, not the first hundred. The old `take: 100` had no order, so Postgres
         * returned about the same hundred each week: on 2026-10-12, 421 of 528 current-season Sleeper
         * leagues had never had a recap. planRecapSweep drops the ones already recapped this week (so a
         * later fire costs nothing for them), caps never-synced leagues per fire, and puts leagues with
         * more AllFantasy members first. The schedule fires three times on Tuesday to finish the walk.
         */
        const allLeagues = await prisma.league.findMany({
          where: { platform: 'sleeper', platformLeagueId: { not: '' } },
          select: { id: true, name: true, platformLeagueId: true, userId: true, settings: true },
        })
        const leagueIds = allLeagues.map((l) => l.id)
        const [recappedRows, warmRows, claimedRows] = await Promise.all([
          prisma.leagueChatMessage
            .findMany({
              where: {
                leagueId: { in: leagueIds },
                createdAt: { gte: new Date(startedAt - 6 * 24 * 60 * 60 * 1000) },
                metadata: { path: ['chimmyMoment', 'kind'], equals: 'weekly_awards' },
              },
              select: { leagueId: true },
              distinct: ['leagueId'],
            })
            .catch(() => [] as Array<{ leagueId: string }>),
          prisma.sportsDataCache
            .findMany({
              where: { cacheKey: { in: allLeagues.map((l) => `${H2H_AGG_PREFIX}${l.platformLeagueId}`) } },
              select: { cacheKey: true },
            })
            .catch(() => [] as Array<{ cacheKey: string }>),
          prisma.leagueTeam
            .groupBy({
              by: ['leagueId'],
              where: { leagueId: { in: leagueIds }, claimedByUserId: { not: null } },
              _count: { _all: true },
            })
            .catch(() => [] as Array<{ leagueId: string; _count: { _all: number } }>),
        ])
        const plan = planRecapSweep({
          leagues: allLeagues,
          recappedThisWeek: new Set(recappedRows.map((r) => r.leagueId)),
          warmSleeperIds: new Set(warmRows.map((r) => r.cacheKey.slice(H2H_AGG_PREFIX.length))),
          // The owner plus claimed teams; an owner who also claimed a team is counted twice, which only
          // nudges the order.
          memberCounts: new Map(claimedRows.map((r) => [r.leagueId, 1 + r._count._all])),
          coldLimit: COLD_LEAGUES_PER_FIRE,
        })
        const leagues = plan.order
        let posted = 0
        let emailsSent = 0
        let skippedForTime = 0
        let optedOut = 0
        const errors: string[] = []
        const postedRecaps: PostedRecap[] = []
        for (const l of leagues) {
          if (!l.platformLeagueId || !l.userId) continue
          /*
           * The commissioner's opt-out from the Commissioner Hub's automations. The recap defaults ON
           * for Sleeper leagues (it ran for all of them before the switch existed), so only an
           * explicit `false` stops it. Skipped before any Sleeper read, so an opted-out league costs
           * nothing, and before the per-week dedupe key is written, so a sibling AllFantasy league
           * for the same Sleeper league still gets its own recap.
           */
          if (!weeklyRecapAllowed(l.settings, 'sleeper')) {
            optedOut += 1
            continue
          }
          if (Date.now() - startedAt > TIME_BUDGET_MS) {
            skippedForTime += 1
            continue
          }
          try {
            const r = await postRecapForLeague(l.id, l.platformLeagueId, l.userId, l.name ?? 'League')
            if (r.posted) {
              posted += 1
              emailsSent += r.emailsSent
              if ('week' in r && r.season && typeof r.week === 'number') {
                postedRecaps.push({
                  leagueId: l.id,
                  leagueName: l.name ?? 'League',
                  ownerUserId: l.userId,
                  season: r.season,
                  week: r.week,
                  text: 'text' in r && typeof r.text === 'string' ? r.text : '',
                })
              }
            }
          } catch {
            errors.push(l.id)
          }
        }
        const nativeLeagues = await prisma.league.findMany({
          where: {
            platform: { in: ['manual', 'allfantasy', 'af', 'native'] },
            settings: { path: ['commissionerRecipes', 'recipes', 'weeklyRecap'], equals: true },
          },
          select: { id: true, name: true, settings: true },
          take: 100,
        })
        let nativePosted = 0
        for (const league of nativeLeagues) {
          if (Date.now() - startedAt > TIME_BUDGET_MS) {
            skippedForTime += 1
            continue
          }
          if (!weeklyRecapAllowed(league.settings, 'manual')) continue
          try {
            const result = await postNativeWeeklyRecap({
              leagueId: league.id,
              leagueName: league.name ?? 'League',
              seasonYear: new Date().getUTCFullYear(),
            })
            if (result.posted) nativePosted += 1
          } catch {
            errors.push(league.id)
          }
        }
        /*
         * The weekly-story push rides this Tuesday fire (the cron registry is full). It runs only
         * with 30s of budget left, AFTER every league's recap, so it can never cost a recap its
         * slot; a skipped week is caught by a manual re-run, which its per-user dedupe makes safe.
         */
        /*
         * "Your recap is ready — share it", one per person per week. Sent before the story push so the
         * story can skip a second push for the same people (weeklyStoryNotify.ts).
         */
        const recapPush = await notifyWeeklyRecaps(postedRecaps, {
          email: process.env.WEEKLY_RECAP_EMAIL_ENABLED === '1',
          baseUrl: getBaseUrl(),
        })
        const stories =
          Date.now() - startedAt < TIME_BUDGET_MS - 30_000
            ? await notifyWeeklyStories(new Date(), recapPush.notified)
            : { targeted: 0, sent: 0, skipped: 0, deferred: true as const }
        return {
          leagues: leagues.length + nativeLeagues.length,
          posted: posted + nativePosted,
          emailsSent: emailsSent + recapPush.emailed,
          skippedForTime,
          optedOut,
          errors,
          stories,
          sweep: { sleeperLeagues: allLeagues.length, alreadyDone: plan.alreadyDone, coldDeferred: plan.coldDeferred },
          recapPush: { sent: recapPush.sent, skipped: recapPush.skipped, emailed: recapPush.emailed },
        }
      },
      (r) => ({
        rowsRead: r.leagues,
        rowsWritten: r.posted,
        rowsSkipped: r.skippedForTime,
        errors: r.errors.map((id) => `league ${id}`),
        warnings: r.skippedForTime > 0 ? [`time budget hit — ${r.skippedForTime} league(s) deferred to the next fire`] : [],
        metadata: { emailsSent: r.emailsSent, optedOut: r.optedOut, weeklyStoryPush: r.stories, sweep: r.sweep, recapPush: r.recapPush },
      }),
    )
    return NextResponse.json({
      mode: 'cron' as const,
      ...sweep,
    })
  }

  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })
  const league = await prisma.league.findFirst({
    where: {
      id: leagueId,
      OR: [{ userId: userId }, { teams: { some: { claimedByUserId: userId } } }],
    },
    select: { id: true, name: true, platform: true, platformLeagueId: true, userId: true, settings: true },
  })
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })
  if (league.platform !== 'sleeper' || !league.platformLeagueId || !league.userId) {
    return NextResponse.json({ supported: false as const, platform: league.platform })
  }
  // A manual trigger by a member must not post a recap the commissioner switched off.
  if (!weeklyRecapAllowed(league.settings, 'sleeper')) {
    return NextResponse.json({ mode: 'manual' as const, posted: false, reason: 'weekly recap is turned off for this league', emailsSent: 0 })
  }
  const result = await postRecapForLeague(league.id, league.platformLeagueId, league.userId, league.name ?? 'League')
  return NextResponse.json({ mode: 'manual' as const, ...result })
}
