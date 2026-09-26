import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getLeagueH2H } from '@/lib/league-history/sleeperH2HService'
import {
  buildWeeklyRecap,
  postWeeklyRecapAsChimmy,
  weeklyRecapAlreadyPosted,
  type WireMatchup,
  type WireRoster,
  type WireUser,
} from '@/lib/league-chat/weeklyRecapMoment'
import { sendTemplatedEmail } from '@/lib/resend-client'
import { renderDigestEmail } from '@/lib/notifications/designedEmail'
import { escapeHtml } from '@/lib/trade-intel/tradeGradeEmail'
import { getBaseUrl } from '@/lib/get-base-url'
import { withSyncJobRun } from '@/lib/production-health/syncJobRunTelemetry'
import { weeklyRecapAllowed } from '@/lib/core-app/commissioner/recipes'
import { createRunBudget } from '@/lib/cron/runBudget'
import { runWeekMatchupMomentsSweep } from '@/lib/league-chat/weekMatchupMoments'

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
 * Email: when WEEKLY_RECAP_EMAIL_ENABLED=1, the recap is also emailed to the
 * league's AllFantasy members (owner + claimed teams). We cannot email
 * leaguemates who aren't on AllFantasy — the chat post covers the league.
 *
 * Cron: Tuesdays (see vercel.json). Manual: a signed-in league member may pass
 * ?leagueId= to post their league's recap now (still deduped).
 *
 * Right after the recaps, the same fire posts each league's CLOSE FINISHES AND UPSETS for the week
 * that just ended — one combined Chimmy post per league per week, for native and imported NFL leagues
 * alike, read from Postgres only (lib/league-chat/weekMatchupMoments.ts). No new cron route: it rides
 * this one, inside the same run budget.
 */

const MAX_RECAP_EMAILS = 25

/**
 * The recaps stop with this much of the shared run budget left, so the close-finish/upset pass always
 * gets a turn. That pass is Postgres reads and one insert per league; the recap's cold H2H sync is
 * the expensive step, and it is the one that waits for the next fire when time is short.
 */
const MOMENTS_RESERVE_MS = 60_000

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

async function memberEmails(afLeagueId: string, ownerUserId: string): Promise<string[]> {
  const teams = await prisma.leagueTeam
    .findMany({
      where: { leagueId: afLeagueId, claimedByUserId: { not: null } },
      select: { claimedByUserId: true },
    })
    .catch(() => [] as { claimedByUserId: string | null }[])
  const userIds = Array.from(
    new Set([ownerUserId, ...teams.map((t) => t.claimedByUserId).filter((v): v is string => Boolean(v))]),
  )
  const users = await prisma.appUser
    .findMany({ where: { id: { in: userIds } }, select: { email: true } })
    .catch(() => [] as { email: string | null }[])
  return Array.from(
    new Set(users.map((u) => u.email).filter((e): e is string => Boolean(e && e.includes('@')))),
  ).slice(0, MAX_RECAP_EMAILS)
}

async function postRecapForLeague(
  afLeagueId: string,
  sleeperLeagueId: string,
  ownerUserId: string,
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
  const lines = text.split('\n')

  // ── Email the AF members (env-gated so beta rollout is deliberate) ──
  let emailsSent = 0
  if (process.env.WEEKLY_RECAP_EMAIL_ENABLED === '1') {
    const recipients = await memberEmails(afLeagueId, ownerUserId)
    const baseUrl = getBaseUrl()
    // sendTemplatedEmail sends this HTML as-is, so the per-line breaks survive.
    // The old sendNotificationEmail path stripped every tag and RE-escaped the
    // pre-escaped source, so the recap arrived as one flat paragraph with
    // visible "&amp;" entities. escapeHtml at the leaf; the shell owns the chrome.
    const html = renderDigestEmail({
      eyebrow: `Week ${awards.week} recap · ${awards.season}`,
      title: leagueName,
      bodyHtml: lines.map((l) => escapeHtml(l)).join('<br/>'),
      cta: { href: `${baseUrl}/league/${afLeagueId}`, label: 'Open your league' },
      baseUrl,
    })
    for (const to of recipients) {
      const sent = await sendTemplatedEmail({
        to,
        subject: `Week ${awards.week} recap — ${leagueName}`,
        html,
      }).catch(() => ({ ok: false as const }))
      if (sent.ok) emailsSent += 1
    }
  }

  return { posted: true, emailsSent }
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization') ?? ''
  const cronSecret = process.env.CRON_SECRET?.trim()
  const isCron = Boolean(cronSecret) && authHeader === `Bearer ${cronSecret}`

  if (isCron) {
    // Time budget: the platform edge severs at 300s, and a cold league's
    // first H2H sync is the expensive step. Stop walking with headroom to spare
    // and report the leftover honestly — the per-week dedupe means the next
    // fire (or a manual re-run) resumes exactly where this one stopped. One
    // budget (lib/cron/runBudget) covers the recaps AND the moments pass after them.
    const sweep = await withSyncJobRun(
      { jobName: 'cron-weekly-awards', trigger: 'cron' },
      async () => {
        const budget = createRunBudget()
        const leagues = await prisma.league.findMany({
          where: { platform: 'sleeper', platformLeagueId: { not: '' } },
          select: { id: true, name: true, platformLeagueId: true, userId: true, settings: true },
          take: 100,
        })
        let posted = 0
        let emailsSent = 0
        let skippedForTime = 0
        let optedOut = 0
        const errors: string[] = []
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
          if (budget.remainingMs() <= MOMENTS_RESERVE_MS) {
            skippedForTime += 1
            continue
          }
          try {
            const r = await postRecapForLeague(l.id, l.platformLeagueId, l.userId, l.name ?? 'League')
            if (r.posted) {
              posted += 1
              emailsSent += r.emailsSent
            }
          } catch {
            errors.push(l.id)
          }
        }
        /*
         * Close finishes and upsets, right after the recaps: one combined Chimmy post per league per
         * week, deduped per league-week, counted against Chimmy's daily cap, silent when the league
         * switched Chimmy off. Whatever budget the recaps left.
         */
        const moments = await runWeekMatchupMomentsSweep({ budget })
        return { leagues: leagues.length, posted, emailsSent, skippedForTime, optedOut, errors, moments }
      },
      (r) => ({
        rowsRead: r.leagues,
        rowsWritten: r.posted + r.moments.posted,
        rowsSkipped: r.skippedForTime + r.moments.skippedForTime,
        errors: r.errors.map((id) => `league ${id}`),
        warnings: [
          ...(r.skippedForTime > 0 ? [`time budget hit — ${r.skippedForTime} league(s) deferred to the next fire`] : []),
          ...(r.moments.skippedForTime > 0
            ? [`time budget hit — close finishes/upsets not checked for ${r.moments.skippedForTime} league(s) this week`]
            : []),
        ],
        metadata: { emailsSent: r.emailsSent, optedOut: r.optedOut, moments: r.moments },
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
