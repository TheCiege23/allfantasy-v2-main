import 'server-only'

import { prisma } from '@/lib/prisma'
import { getBaseUrl } from '@/lib/get-base-url'
import { sendTemplatedEmail } from '@/lib/resend-client'
import { createEmailUnsubscribeToken } from '@/lib/email/marketing-email'
import { getTradeGrades } from '@/lib/trade-intel/sleeperTradeGradeService'
import { buildTradeGradeEmail } from '@/lib/trade-intel/tradeGradeEmail'
import { loadTradePsychology } from '@/lib/trade-intel/tradePsychologyLoader'
import { canAccessForUser } from '@/lib/access/canAccessForUser'
import { loadTradeExpectation } from '@/lib/trade-intel/tradeExpectationLoader'
import { currentCompletedTradeIds } from '@/lib/trade-intel/sleeperTradeSync'

/**
 * tradeNotifyService — "your league just traded" with INSTANT grades.
 *
 * Flow per league (invoked by the cron route):
 *  1. Cheap detection: read the CURRENT season's transaction feed and collect
 *     completed trade ids.
 *  2. Diff against the seen-set stored in SportsDataCache (no migrations).
 *  3. On a new trade: force-refresh the graded ledger (so the fresh trade is
 *     graded), then email every AF member of that league the initial grades
 *     with a link to the Legacy ledger.
 *
 * Honesty + noise rules:
 *  - BOOTSTRAP: the first run for a league records every existing trade as
 *    seen and sends NOTHING — history is browsable in the app; email is only
 *    for what happens after you turned this on.
 *  - Emails go only to AF users attached to the league (owner + claimed
 *    teams). We cannot email league members who aren't on AllFantasy.
 *  - Every failure is contained per-league; one broken league never blocks
 *    the rest of the sweep.
 */

const SEEN_PREFIX = 'trade-notify:v1:'
const SEEN_TTL_MS = 2 * 365 * 24 * 60 * 60 * 1000

type SeenRecord = { version: 1; seen: string[]; lastRunIso: string }

async function readSeen(sleeperLeagueId: string): Promise<SeenRecord | null> {
  const row = await prisma.sportsDataCache
    .findUnique({ where: { cacheKey: `${SEEN_PREFIX}${sleeperLeagueId}` } })
    .catch(() => null)
  const data = row?.data as unknown as SeenRecord | null
  return data?.version === 1 && Array.isArray(data.seen) ? data : null
}

async function writeSeen(sleeperLeagueId: string, seen: string[]): Promise<void> {
  const cacheKey = `${SEEN_PREFIX}${sleeperLeagueId}`
  const data = { version: 1, seen: seen.slice(-500), lastRunIso: new Date().toISOString() } as unknown as object
  const expiresAt = new Date(Date.now() + SEEN_TTL_MS)
  await prisma.sportsDataCache
    .upsert({ where: { cacheKey }, update: { data, expiresAt }, create: { cacheKey, data, expiresAt } })
    .catch(() => null)
}

export type LeagueNotifyResult = {
  sleeperLeagueId: string
  checked: boolean
  bootstrap: boolean
  newTrades: number
  emailsSent: number
  error?: string
}

/** Detect + notify for one Sleeper league id (may map to several AF league rows). */
export async function detectAndNotifyLeague(sleeperLeagueId: string): Promise<LeagueNotifyResult> {
  const base: LeagueNotifyResult = {
    sleeperLeagueId,
    checked: false,
    bootstrap: false,
    newTrades: 0,
    emailsSent: 0,
  }
  try {
    const currentIds = await currentCompletedTradeIds(sleeperLeagueId)
    if (currentIds == null) return { ...base, error: 'transaction feed unavailable' }
    base.checked = true

    const seenRecord = await readSeen(sleeperLeagueId)
    if (!seenRecord) {
      // First run: record history, notify nothing (no retro spam).
      await writeSeen(sleeperLeagueId, currentIds)
      return { ...base, bootstrap: true }
    }

    const seen = new Set(seenRecord.seen)
    const newIds = currentIds.filter((id) => !seen.has(id))
    if (newIds.length === 0) return base
    base.newTrades = newIds.length

    // Fresh grades so the new trade is included and graded.
    const grades = await getTradeGrades(sleeperLeagueId, { force: true })
    // Mark seen regardless — a grading hiccup must not cause duplicate emails later.
    await writeSeen(sleeperLeagueId, [...seenRecord.seen, ...newIds])
    if (!grades) return { ...base, error: 'grading unavailable — trade recorded, email skipped' }

    const newTrades = grades.trades.filter((t) => newIds.some((id) => t.id.endsWith(`:${id}`)))
    if (newTrades.length === 0) return { ...base, error: 'new trade not present in graded ledger yet' }

    // Recipients: AF users attached to any AF league row for this Sleeper league.
    const afLeagues = await prisma.league.findMany({
      where: { platform: 'sleeper', platformLeagueId: sleeperLeagueId },
      select: {
        id: true,
        name: true,
        userId: true,
        teams: { select: { claimedByUserId: true } },
      },
    })
    if (afLeagues.length === 0) return base
    const userIds = [
      ...new Set(
        afLeagues.flatMap((l) => [l.userId, ...l.teams.map((t) => t.claimedByUserId)]).filter(
          (v): v is string => typeof v === 'string' && v.length > 0,
        ),
      ),
    ]
    const users = await prisma.appUser
      .findMany({ where: { id: { in: userIds } }, select: { id: true, email: true } })
      .catch(() => [] as { id: string; email: string | null }[])
    // Keep the id alongside the address: manager psychology is premium, and the
    // entitlement is per recipient, so the email can no longer be built once and
    // blasted to a list.
    const recipients: Array<{ id: string; email: string }> = []
    const seenEmails = new Set<string>()
    for (const u of users) {
      const email = u.email
      if (!email || seenEmails.has(email)) continue
      seenEmails.add(email)
      recipients.push({ id: u.id, email })
    }
    if (recipients.length === 0) return base

    const leagueName = afLeagues[0].name ?? 'your league'
    const ledgerUrl = `${getBaseUrl()}/league/${afLeagues[0].id}?view=legacy`
    for (const trade of newTrades) {
      // League shape, scoring settings, last season's real production and roster
      // needs. Optional by design: if any of it is unavailable the email falls
      // back to what realized points alone can prove.
      const expectation = await loadTradeExpectation(sleeperLeagueId, trade).catch(() => null)

      // How these two have traded before. Context only — it never touches the
      // grade — and premium, since it characterises other managers.
      const psychology = await loadTradePsychology({
        leagueId: afLeagues[0].id,
        sides: trade.sides.map((s) => ({ rosterId: s.rosterId, managerName: s.managerName })),
      }).catch(() => null)

      for (const recipient of recipients) {
        const entitled = psychology
          ? await canAccessForUser('manager_psychology', {
              userId: recipient.id,
              email: recipient.email,
            })
              .then((d) => d.allowed)
              .catch(() => false)
          : false
        const { subject, html } = buildTradeGradeEmail({
          leagueName,
          trade,
          ledgerUrl,
          expectation,
          psychology: entitled ? psychology : null,
          /*
           * 22a's footer. `leagueId` powers the PER-LEAGUE mute — at 61 leagues,
           * a global unsubscribe is not a real choice, because it makes silencing
           * one noisy league cost you every trade email you actually wanted.
           *
           * The unsubscribe token is minted per RECIPIENT, inside this loop. It
           * is signed over their own address, so hoisting it out of the loop
           * would send every member of the league the same link and let any one
           * of them unsubscribe the rest.
           */
          baseUrl: getBaseUrl(),
          leagueId: afLeagues[0].id,
          unsubscribeUrl: `${getBaseUrl()}/api/email/unsubscribe?token=${encodeURIComponent(
            createEmailUnsubscribeToken(recipient.email),
          )}`,
        })
        const sent = await sendTemplatedEmail({ to: recipient.email, subject, html }).catch(
          () => ({ ok: false as const }),
        )
        if (sent.ok) base.emailsSent += 1
      }
    }
    return base
  } catch (err) {
    console.error('[trade-notify] league sweep failed', { sleeperLeagueId, err })
    return { ...base, error: 'unexpected failure' }
  }
}

/** Sweep every imported Sleeper league (bounded), one contained result each. */
export async function detectAndNotifyAll(limit = 50): Promise<LeagueNotifyResult[]> {
  const leagues = await prisma.league.findMany({
    where: { platform: 'sleeper', platformLeagueId: { not: '' } },
    select: { platformLeagueId: true },
    distinct: ['platformLeagueId'],
    take: limit,
  })
  const results: LeagueNotifyResult[] = []
  for (const l of leagues) {
    if (!l.platformLeagueId) continue
    results.push(await detectAndNotifyLeague(l.platformLeagueId))
  }
  return results
}
