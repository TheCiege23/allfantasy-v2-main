import 'server-only'

import { prisma } from '@/lib/prisma'
import { getBaseUrl } from '@/lib/get-base-url'
import { sendPushToUser } from '@/lib/push-notifications'
import { decidePushForUser } from '@/lib/notifications/pushGate'
import { sendTemplatedEmail } from '@/lib/resend-client'
import { createEmailUnsubscribeToken } from '@/lib/email/marketing-email'
import { getTradeGrades, type GradedTrade } from '@/lib/trade-intel/sleeperTradeGradeService'
import { buildPendingTradeOfferEmail, buildTradeGradeEmail } from '@/lib/trade-intel/tradeGradeEmail'
import { completedTradeGraderFor, oneGradeForCompletedTrade } from '@/lib/decision-os/trade/completedTradeGrade'
import { createLeagueTradeGrader, gradeDeal, type LeagueTradeGrader } from '@/lib/decision-os/trade/leagueTradeGrader'
import { gradeInputsFromPending } from '@/lib/decision-os/trade/tradeGradeInputs'
import type { TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'
import type { LeagueTypeBasis } from '@/lib/league/leagueTypeGrading'
import { archiveCompletedFeedTrades } from '@/lib/import-os/collector/archiveFeedTrades'
import {
  currentTradeIds,
  fetchLeagueRosters,
  type FeedTrade,
  type SleeperRoster,
} from '@/lib/trade-intel/sleeperTradeSync'
import { buildTradeAssetsForRoster } from '@/lib/provider-trades/scanPendingSleeperTrades'
import { getAllPlayers, getLeagueUsers } from '@/lib/api-cache/SleeperCacheLayer'
import { resolveSourceScreenLink } from '@/lib/league-links/sourceLinkResolver'
import { isUndeliverableEmailDomain } from '@/lib/email/undeliverableDomains'

/**
 * tradeNotifyService — "your league just traded" with INSTANT grades, and "a trade is waiting on
 * you" for an offer still open.
 *
 * Flow per league (invoked by the cron route):
 *  1. Cheap detection: read the CURRENT season's transaction feed and collect
 *     pending and completed trades.
 *  2. Diff against the seen-set stored in SportsDataCache (no migrations).
 *  3. A new OFFER is sent to the managers in it who still have to answer it. A new COMPLETION —
 *     including an offer we saw while it was pending — force-refreshes the graded ledger and emails
 *     every AF member of the league the initial grades.
 *
 * Honesty + noise rules:
 *  - BOOTSTRAP: the first run for a league records every existing trade as
 *    seen and sends NOTHING — history is browsable in the app; email is only
 *    for what happens after you turned this on.
 *  - Emails go only to AF users attached to the league (owner + claimed
 *    teams). We cannot email league members who aren't on AllFantasy.
 *  - Every link goes to the RECIPIENT'S OWN copy of the league. See `rowFor`.
 *  - Every failure is contained per-league; one broken league never blocks
 *    the rest of the sweep.
 */

const SEEN_PREFIX = 'trade-notify:v1:'
const SEEN_TTL_MS = 2 * 365 * 24 * 60 * 60 * 1000

/**
 * ⚠ VERSION 2, AND THE BUMP IS THE MIGRATION.
 *
 * A v1 record was built from COMPLETED trades only. If v2 simply started reading pending ones
 * against it, every offer already sitting open in every league would look brand new on the first
 * run — a retro-spam burst of emails and push notifications about trades days or weeks old, which
 * is exactly what the bootstrap path below exists to prevent.
 *
 * `readSeen` accepts only version 2, so a v1 record reads as ABSENT, the existing bootstrap records
 * everything currently in the feed and notifies nothing, and the league is live from its second
 * run. One quiet run per league, no migration script, no burst.
 *
 * `pending` was added inside version 2 and is OPTIONAL on purpose: a record written before it reads
 * as "no offers outstanding", which is the correct reading of a record that never tracked any, and
 * does not cost every league a second quiet run.
 */
type SeenRecord = { version: 2; seen: string[]; pending?: string[]; owed?: OwedAlert[]; lastRunIso: string }

/**
 * An alert this league still owes somebody: planned, but not yet delivered to everyone it is for.
 *
 * 🛑 THE BUG THIS EXISTS FOR (2026-09-25). A trade is marked seen BEFORE it is graded and sent, so
 * a sweep that crashes or retries can never email it twice. But that made every failure after the
 * write permanent: "grading unavailable", "not present in graded ledger yet", "rosters
 * unavailable", or one failed send, and the email was gone for good. Seen and delivered were one
 * bit.
 *
 * Now they are two. `seen` still says "planned" and is still written first. What was planned and
 * not yet delivered stays here and is retried by the next sweep. Duplicates are stopped by a claim
 * row per (alert, recipient, channel) — `claimSend` — rather than by never trying again.
 *
 * `since` is when the alert was first planned; an alert still owed after `OWED_MAX_AGE_MS` is
 * dropped as stale news rather than retried forever. Optional, like `pending`: a record written
 * before it existed owes nothing.
 */
export type OwedAlert = { kind: 'offer' | 'completion'; id: string; since: string }

/** Past this, an undelivered alert is stale news: dropped and logged, not sent. */
export const OWED_MAX_AGE_MS = 48 * 60 * 60 * 1000

const owedKey = (a: Pick<OwedAlert, 'kind' | 'id'>): string => `${a.kind}:${a.id}`

async function readSeen(sleeperLeagueId: string): Promise<SeenRecord | null> {
  const row = await prisma.sportsDataCache
    .findUnique({ where: { cacheKey: `${SEEN_PREFIX}${sleeperLeagueId}` } })
    .catch(() => null)
  const data = row?.data as unknown as SeenRecord | null
  return data?.version === 2 && Array.isArray(data.seen) ? data : null
}

async function writeSeen(
  sleeperLeagueId: string,
  seen: string[],
  pending: string[] = [],
  owed: OwedAlert[] = [],
): Promise<void> {
  const cacheKey = `${SEEN_PREFIX}${sleeperLeagueId}`
  const data = { version: 2, seen: seen.slice(-500), pending: pending.slice(-200), owed: owed.slice(-100), lastRunIso: new Date().toISOString() } as unknown as object
  const expiresAt = new Date(Date.now() + SEEN_TTL_MS)
  await prisma.sportsDataCache
    .upsert({ where: { cacheKey }, update: { data, expiresAt }, create: { cacheKey, data, expiresAt } })
    .catch(() => null)
}

/**
 * One delivery, claimed before it is attempted — so a retried alert reaches only the people it
 * has not reached yet, and two overlapping sweeps cannot both send it.
 *
 * Keys are `trade-notify:sent:v1:<sleeperLeagueId>:<kind>:<tradeId>:<channel>:<userId>`, created
 * with a unique key; a unique violation means someone already delivered it. Rows outlive
 * `OWED_MAX_AGE_MS` by a wide margin, which is all they need: past that nothing retries.
 */
export const SENT_CLAIM_PREFIX = 'trade-notify:sent:v1:'
const SENT_CLAIM_TTL_MS = 30 * 24 * 60 * 60 * 1000

type ClaimResult = 'ours' | 'taken' | 'unavailable'

function sentClaimKey(
  sleeperLeagueId: string,
  alert: Pick<OwedAlert, 'kind' | 'id'>,
  channel: 'email' | 'push',
  userId: string,
): string {
  return `${SENT_CLAIM_PREFIX}${sleeperLeagueId}:${alert.kind}:${alert.id}:${channel}:${userId}`
}

/**
 * ⚠ 'unavailable' FAILS OPEN — the caller sends anyway. A claim store that cannot be written is the
 * database being down, and the sweep has already failed to read or write its seen record by then;
 * sending without a claim is exactly what this service did before claims existed.
 */
async function claimSend(key: string): Promise<ClaimResult> {
  try {
    await prisma.sportsDataCache.create({
      data: { cacheKey: key, data: { claimedAt: new Date().toISOString() }, expiresAt: new Date(Date.now() + SENT_CLAIM_TTL_MS) },
    })
    return 'ours'
  } catch (e) {
    const code = e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : null
    return code === 'P2002' ? 'taken' : 'unavailable'
  }
}

/** A send that failed gives its claim back, so the next sweep tries that recipient again. */
async function releaseSend(key: string): Promise<void> {
  await prisma.sportsDataCache.deleteMany({ where: { cacheKey: key } }).catch(() => undefined)
}

export type TradeNotificationPlan = {
  /** Offers to announce: new ones, plus owed ones still open. */
  offers: FeedTrade[]
  /** Trade ids to announce as completed: new ones, plus owed ones. */
  completions: string[]
  seen: string[]
  pending: string[]
  /** Everything in `offers` and `completions`, owed until it is delivered. */
  owed: OwedAlert[]
  /** Owed alerts this run gave up on — too old, or an offer no longer open. Logged, never sent. */
  dropped: OwedAlert[]
}

/**
 * What this run must announce, and what to remember afterwards. PURE.
 *
 * 🛑 THE BUG THIS EXISTS FOR. The notifier used to hold one set, `seen`. A trade caught while
 * PENDING went into it, the email was then built from the graded ledger — which reads completed
 * trades only — so the offer was not found and nothing was sent. When the offer was accepted it
 * kept its transaction id, was already `seen`, and the completion was never announced either. The
 * better the sweep got at catching offers early, the more trades it silently swallowed.
 *
 * So an offer is remembered in `pending` until it completes, and a completed trade is announced
 * when it is new OR was last seen pending. An offer that is withdrawn simply never completes; it
 * ages out of the capped list.
 *
 * Owed alerts (see `OwedAlert`) are carried into the plan again:
 *  - an owed COMPLETION is retried whether or not it is still in the feed, because the feed is a
 *    few weeks wide and the email is built from the graded ledger, not from the feed;
 *  - an owed OFFER is retried only while the feed still shows it open. Accepted, it is announced as
 *    a completion instead (it is still in `pending`); withdrawn or out of the window, it is dropped;
 *  - anything owed longer than `OWED_MAX_AGE_MS` is dropped.
 */
export function planTradeNotifications(
  feed: FeedTrade[],
  record: { seen: string[]; pending?: string[]; owed?: OwedAlert[] },
  nowMs: number = Date.now(),
): TradeNotificationPlan {
  const seen = new Set(record.seen)
  const pending = new Set(record.pending ?? [])
  const offers: FeedTrade[] = []
  const completions: string[] = []
  const newIds: string[] = []
  const handled = new Set<string>()
  const nowIso = new Date(nowMs).toISOString()
  const owed = new Map<string, OwedAlert>()
  const dropped: OwedAlert[] = []

  for (const trade of feed) {
    if (handled.has(trade.id)) continue
    handled.add(trade.id)
    const isNew = !seen.has(trade.id)
    if (isNew) newIds.push(trade.id)
    if (trade.status === 'pending') {
      if (isNew) {
        offers.push(trade)
        pending.add(trade.id)
      }
    } else if (isNew || pending.has(trade.id)) {
      completions.push(trade.id)
      pending.delete(trade.id)
    }
  }

  const feedById = new Map(feed.map((t) => [t.id, t]))
  for (const prior of record.owed ?? []) {
    if (!prior || (prior.kind !== 'offer' && prior.kind !== 'completion') || typeof prior.id !== 'string') continue
    const sinceMs = Date.parse(prior.since)
    if (!Number.isFinite(sinceMs) || nowMs - sinceMs > OWED_MAX_AGE_MS) {
      dropped.push(prior)
      continue
    }
    if (prior.kind === 'completion') {
      if (!completions.includes(prior.id)) completions.push(prior.id)
      owed.set(owedKey(prior), prior)
      continue
    }
    const live = feedById.get(prior.id)
    if (live?.status !== 'pending') {
      // Accepted: announced as a completion above, if it was still pending. Gone: nothing to answer.
      dropped.push(prior)
      continue
    }
    if (!offers.some((o) => o.id === prior.id)) offers.push(live)
    owed.set(owedKey(prior), prior)
  }

  for (const offer of offers) {
    const key = owedKey({ kind: 'offer', id: offer.id })
    if (!owed.has(key)) owed.set(key, { kind: 'offer', id: offer.id, since: nowIso })
  }
  for (const id of completions) {
    const key = owedKey({ kind: 'completion', id })
    if (!owed.has(key)) owed.set(key, { kind: 'completion', id, since: nowIso })
  }

  return { offers, completions, seen: [...record.seen, ...newIds], pending: [...pending], owed: [...owed.values()], dropped }
}

export type LeagueNotifyResult = {
  sleeperLeagueId: string
  checked: boolean
  bootstrap: boolean
  /** Completed trades announced this run. */
  newTrades: number
  /** Open offers announced this run. */
  newOffers: number
  emailsSent: number
  /** Alerts still owed after this run — retried by the next sweep. */
  stillOwed?: number
  error?: string
}

type AfLeagueRow = {
  id: string
  name: string | null
  userId: string
  sport: string
  teams: Array<{ claimedByUserId: string | null; platformUserId: string | null }>
}

type Recipient = { id: string; email: string }

/**
 * The AF users attached to any AF copy of this Sleeper league, minus opt-outs and undeliverable
 * addresses.
 */
async function resolveRecipients(afLeagues: AfLeagueRow[]): Promise<Recipient[]> {
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
  // Keep the id alongside the address: each recipient is graded on their own copy
  // of the league and sees their own side, so the email can never be built once
  // and blasted to a list.
  /*
   * ⚠ PREFERENCES AND DELIVERABILITY ARE CHECKED HERE, BEFORE ANY SEND.
   * This loop used to email every attached user unconditionally: the
   * unsubscribe link in the footer demonstrably did not stop the next
   * sweep (nothing read EmailPreference), and RFC-reserved fixture
   * addresses kept getting hit, burning the sending domain's reputation.
   */
  const candidateEmails = [...new Set(users.map((u) => u.email).filter((e): e is string => !!e))]
  const prefRows = await prisma.emailPreference
    .findMany({
      where: { email: { in: candidateEmails } },
      select: { email: true, tradeAlerts: true, unsubscribedAt: true },
    })
    .catch(() => [] as { email: string; tradeAlerts: boolean; unsubscribedAt: Date | null }[])
  const blocked = new Set(
    prefRows.filter((p) => p.unsubscribedAt != null || p.tradeAlerts === false).map((p) => p.email),
  )

  const recipients: Recipient[] = []
  const seenEmails = new Set<string>()
  for (const u of users) {
    const email = u.email
    if (!email || seenEmails.has(email)) continue
    seenEmails.add(email)
    if (blocked.has(email)) continue
    if (isUndeliverableEmailDomain(email)) continue
    recipients.push({ id: u.id, email })
  }
  return recipients
}

const uniqueIds = (rows: FeedTrade[]): string[] => [...new Set(rows.map((r) => r.id))]

/**
 * Which Sleeper account each AF user is in this league — the claimed team's platform id on their own
 * row, else the Sleeper id on their profile. The same rule the league's Trades panel uses, so "your
 * side" in an email is the side the screen calls yours.
 */
async function sleeperIdResolver(
  afLeagues: AfLeagueRow[],
  recipients: Recipient[],
  rowFor: (userId: string) => AfLeagueRow,
): Promise<{ attachedUserIds: string[]; sleeperIdOf: (userId: string) => string | null }> {
  const attachedUserIds = [
    ...new Set([
      ...recipients.map((r) => r.id),
      ...afLeagues.flatMap((l) => [l.userId, ...l.teams.map((t) => t.claimedByUserId)]),
    ].filter((v): v is string => typeof v === 'string' && v.length > 0)),
  ]
  const profiles = await prisma.userProfile
    .findMany({
      where: { userId: { in: attachedUserIds } },
      select: { userId: true, sleeperUserId: true },
    })
    .catch(() => [] as Array<{ userId: string; sleeperUserId: string | null }>)
  const profileSleeperId = new Map(profiles.map((p) => [p.userId, p.sleeperUserId?.trim() || null]))
  const sleeperIdOf = (userId: string): string | null => {
    const claimed = rowFor(userId).teams.find((t) => t.claimedByUserId === userId)?.platformUserId?.trim()
    return claimed || profileSleeperId.get(userId) || null
  }
  return { attachedUserIds, sleeperIdOf }
}

/**
 * One completed-trade grade per (league row, trade) in a sweep — several recipients can share a row.
 * The grader is read first so a withheld grade still carries the league type it would have used.
 */
function completedGradeCache(): (
  rowId: string,
  trade: GradedTrade,
) => Promise<{ grade: TradeGradeView | null; leagueType: LeagueTypeBasis | null }> {
  const season = new Date().getUTCFullYear()
  const memo = new Map<string, Promise<{ grade: TradeGradeView | null; leagueType: LeagueTypeBasis | null }>>()
  return (rowId, trade) => {
    const key = `${rowId}|${trade.id}`
    let hit = memo.get(key)
    if (!hit) {
      hit = (async () => {
        const grader: LeagueTradeGrader | null = await completedTradeGraderFor(rowId).catch(() => null)
        const grade = await oneGradeForCompletedTrade(rowId, trade, season, { graderFor: async () => grader }).catch(() => null)
        return { grade, leagueType: grade?.leagueType ?? grader?.leagueType ?? null }
      })()
      memo.set(key, hit)
    }
    return hit
  }
}

/** Where a manager confirms their league type — the anchor the app's league-type note links to. */
function confirmUrlFor(rowId: string): string {
  return `${getBaseUrl()}/core?league=${encodeURIComponent(rowId)}#league-type`
}

/** Sleeper's transaction id, from a graded-ledger id shaped `<leagueId>:<transactionId>`. */
function transactionIdOf(tradeId: string): string {
  return tradeId.split(':').pop() ?? tradeId
}

type SleeperUserRow = { user_id?: string; display_name?: string; metadata?: { team_name?: string } }
type SleeperPlayerRow = { full_name?: string; first_name?: string; last_name?: string; position?: string; team?: string }

/** Detect + notify for one Sleeper league id (may map to several AF league rows). */
export async function detectAndNotifyLeague(sleeperLeagueId: string): Promise<LeagueNotifyResult> {
  const base: LeagueNotifyResult = {
    sleeperLeagueId,
    checked: false,
    bootstrap: false,
    newTrades: 0,
    newOffers: 0,
    emailsSent: 0,
  }
  try {
    const feed = await currentTradeIds(sleeperLeagueId)
    if (feed == null) return { ...base, error: 'transaction feed unavailable' }
    base.checked = true

    const seenRecord = await readSeen(sleeperLeagueId)
    if (!seenRecord) {
      // First run: record history, notify nothing (no retro spam). An offer open right now is
      // remembered as pending, so its completion — which happens after this — is still announced.
      await writeSeen(sleeperLeagueId, uniqueIds(feed), uniqueIds(feed.filter((f) => f.status === 'pending')))
      return { ...base, bootstrap: true }
    }

    const plan = planTradeNotifications(feed, seenRecord)
    if (plan.dropped.length > 0) {
      // Never silent: an alert given up on is the thing this record exists to prevent.
      console.warn('[trade-notify] owed alerts dropped undelivered', {
        sleeperLeagueId,
        dropped: plan.dropped.map((a) => ({ alert: owedKey(a), since: a.since })),
      })
    }
    if (plan.offers.length === 0 && plan.completions.length === 0) {
      if (plan.dropped.length > 0) await writeSeen(sleeperLeagueId, plan.seen, plan.pending, plan.owed)
      return base
    }
    base.newTrades = plan.completions.length
    base.newOffers = plan.offers.length

    /*
     * Seen AND owed, written before anything is sent. A crash from here on leaves every alert owed
     * for the next sweep, and the per-recipient claims (`claimSend`) stop that retry from reaching
     * anyone who already has it. This used to write `seen` alone, "so a grading or send hiccup must
     * not cause duplicate emails later" — which it achieved by never trying again.
     */
    await writeSeen(sleeperLeagueId, plan.seen, plan.pending, plan.owed)
    const delivered = new Set<string>()
    try {
      return await deliverPlan({ sleeperLeagueId, feed, plan, base, delivered })
    } finally {
      // Whatever was not confirmed delivered stays owed — including after an unexpected throw.
      const stillOwed = plan.owed.filter((a) => !delivered.has(owedKey(a)))
      base.stillOwed = stillOwed.length
      if (stillOwed.length !== plan.owed.length) {
        await writeSeen(sleeperLeagueId, plan.seen, plan.pending, stillOwed)
      }
    }
  } catch (err) {
    console.error('[trade-notify] league sweep failed', { sleeperLeagueId, err })
    return { ...base, error: 'unexpected failure' }
  }
}

/**
 * Send what `plan` announces. Every alert confirmed delivered to everyone it is for is added to
 * `delivered`; the caller keeps the rest owed.
 */
async function deliverPlan(args: {
  sleeperLeagueId: string
  feed: FeedTrade[]
  plan: TradeNotificationPlan
  base: LeagueNotifyResult
  delivered: Set<string>
}): Promise<LeagueNotifyResult> {
  const { sleeperLeagueId, feed, plan, base, delivered } = args
  const settleCompletions = (ids: string[]) => ids.forEach((id) => delivered.add(owedKey({ kind: 'completion', id })))

  /*
   * A completion this sweep noticed goes into the trade archive now, from the feed already in
   * hand — for leagues nobody has opened since, this sweep is the first reader to see it
   * (`archiveFeedTrades.ts`). Awaited, not backgrounded: a cron has no response to protect, and
   * a background write could outlive the run's budget. It never throws, and it upserts, so an
   * owed completion archived again on retry costs a few no-op writes.
   */
  if (plan.completions.length > 0) await archiveCompletedFeedTrades({ sleeperLeagueId, feed })

  // Recipients: AF users attached to any AF league row for this Sleeper league.
  const afLeagues: AfLeagueRow[] = await prisma.league.findMany({
    where: { platform: 'sleeper', platformLeagueId: sleeperLeagueId },
    select: {
      id: true,
      name: true,
      userId: true,
      sport: true,
      teams: { select: { claimedByUserId: true, platformUserId: true } },
    },
    // Deterministic, so the fallback row below is the same one on every run.
    orderBy: { createdAt: 'asc' },
  })
  if (afLeagues.length === 0) {
    // Nobody on AllFantasy to tell: nothing is owed to anyone.
    plan.owed.forEach((a) => delivered.add(owedKey(a)))
    return base
  }
  const recipients = await resolveRecipients(afLeagues)

  /*
   * ⚠ THE DM HALF DOES NOT DEPEND ON WHO GETS EMAIL. `recipients` is filtered by email opt-outs
   * and deliverability; the offer card in the two managers' DM is a chat message, not a mail, so
   * a manager who unsubscribed from trade emails still sees the offer in the conversation. This
   * used to return here when no one could be emailed — which would also have skipped the DM.
   */
  if (plan.completions.length > 0) {
    await announceCompletionsInDms(sleeperLeagueId, plan.completions)
  }
  if (recipients.length === 0 && plan.offers.length === 0) {
    settleCompletions(plan.completions)
    return base
  }

  /*
   * 🛑 THE RECIPIENT'S OWN COPY OF THE LEAGUE, NEVER `afLeagues[0]`.
   *
   * A Sleeper league imported by several AllFantasy users is one AF row PER importer. Every link
   * used to point at `afLeagues[0]` — whichever row the query returned first — and /core treats a
   * `?league=` the viewer does not play as unauthorised and redirects to the cross-league board,
   * which cannot show a Sleeper trade. So everyone but one importer clicked "See the full
   * breakdown" and landed somewhere the trade was not. Measured 2026-09-24: 28 Sleeper leagues,
   * 65 AF rows. A mute is saved per row too, so the footer and the push gate take the same row.
   */
  const rowFor = (userId: string): AfLeagueRow =>
    afLeagues.find((l) => l.userId === userId || l.teams.some((t) => t.claimedByUserId === userId)) ??
    afLeagues[0]
  const tradeUrl = (rowId: string, transactionId: string) =>
    `/core/trades?league=${encodeURIComponent(rowId)}&trade=${encodeURIComponent(transactionId)}`
  const unsubscribeUrlFor = (email: string) =>
    `${getBaseUrl()}/api/email/unsubscribe?token=${encodeURIComponent(createEmailUnsubscribeToken(email))}`

  if (plan.offers.length > 0) {
    const sent = await notifyOffers({ sleeperLeagueId, offers: plan.offers, afLeagues, recipients, rowFor, tradeUrl, unsubscribeUrlFor })
    base.emailsSent += sent.emailsSent
    sent.delivered.forEach((id) => delivered.add(owedKey({ kind: 'offer', id })))
    if (sent.error) base.error = sent.error
  }

  // Nobody to email about a completion: skip the forced grade refresh it would cost.
  if (plan.completions.length === 0) return base
  if (recipients.length === 0) {
    settleCompletions(plan.completions)
    return base
  }

  // Fresh grades so the new trade is included and graded.
  const grades = await getTradeGrades(sleeperLeagueId, { force: true })
  if (!grades) {
    // Mutated, not copied: the caller records `stillOwed` on this same object.
    base.error = 'grading unavailable — completion owed, retried next sweep'
    return base
  }

  const newTrades = grades.trades.filter((t) => plan.completions.includes(transactionIdOf(t.id)))
  const inLedger = new Set(newTrades.map((t) => transactionIdOf(t.id)))
  const notYet = plan.completions.filter((id) => !inLedger.has(id))
  if (notYet.length > 0) {
    base.error = `${notYet.length} completed trade(s) not in the graded ledger yet — owed, retried next sweep`
  }
  if (newTrades.length === 0) return base

  const { sleeperIdOf } = await sleeperIdResolver(afLeagues, recipients, rowFor)
  const gradeFor = completedGradeCache()

  for (const trade of newTrades) {
    const transactionId = transactionIdOf(trade.id)
    let everyoneHasIt = true
    for (const recipient of recipients) {
      const row = rowFor(recipient.id)
      const leagueName = row.name ?? afLeagues[0].name ?? 'your league'
      const href = tradeUrl(row.id, transactionId)
      const outcome = await deliverToRecipient({
        sleeperLeagueId,
        alert: { kind: 'completion', id: transactionId },
        recipient,
        leagueRowId: row.id,
        /*
         * ⚠ AND THE PHONE. This service emailed and stopped, so a trade landing
         * — one of the two things a manager actually wants a buzz for — never
         * reached anyone's home screen, even though the whole push stack ships:
         * the subscription table, the send service, and a service worker that
         * already carries trade action buttons and a league-scoped deep link.
         *
         * 🛑 GATED ON THE USER'S NOTIFICATION SETTINGS since 2026-09-14, against the recipient's
         * OWN league row: imported leagues are per-user copies, so a mute is saved on theirs.
         * A settings read that fails sends nothing.
         */
        pushCategory: 'trade_accept_reject',
        push: (subject) => ({
          title: `Trade accepted in ${leagueName}`,
          body: subject,
          href,
          tag: `trade:${row.id}:${trade.id}`,
          type: 'trade',
          leagueId: row.id,
        }),
        compose: async () => {
          /*
           * 🛑 THE RECIPIENT'S OWN ROW, GRADED BY THE APP'S OWN FUNCTION (2026-09-25). This used to grade
           * once per trade on `findFirst({ platformLeagueId })` — whichever importer's copy came back —
           * so the inbox said B (+24%) where the reader's screen said A (+25%): two rows, two sets of
           * settings, one band edge. Now each row is graded by `oneGradeForCompletedTrade`, which is
           * what /core Trades and the home band call for this trade, once per row.
           */
          const { grade, leagueType } = await gradeFor(row.id, trade)
          return buildTradeGradeEmail({
            leagueName,
            trade,
            ledgerUrl: `${getBaseUrl()}${href}`,
            grade,
            leagueType,
            viewerOwnerId: sleeperIdOf(recipient.id),
            confirmUrl: confirmUrlFor(row.id),
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
            leagueId: row.id,
            unsubscribeUrl: unsubscribeUrlFor(recipient.email),
          })
        },
      })
      if (outcome.emailed) base.emailsSent += 1
      if (!outcome.delivered) everyoneHasIt = false
    }
    if (everyoneHasIt) delivered.add(owedKey({ kind: 'completion', id: transactionId }))
  }
  return base
}

/**
 * One alert to one recipient: the email and the push, each claimed before it is attempted, so a
 * retried alert reaches only the people it has not reached yet.
 *
 * `delivered` is about the EMAIL — sent now, or by an earlier sweep. Push stays best-effort as it
 * always was: a failed push is not retried, and a push the user's settings refuse is not owed.
 * `compose` runs only when something still needs sending, so a retry does not re-grade the trade
 * for everyone who already has it.
 */
async function deliverToRecipient(args: {
  sleeperLeagueId: string
  alert: Pick<OwedAlert, 'kind' | 'id'>
  recipient: Recipient
  leagueRowId: string
  pushCategory: 'trade_proposals' | 'trade_accept_reject'
  push: (subject: string) => Parameters<typeof sendPushToUser>[1]
  compose: () => Promise<{ subject: string; html: string }>
}): Promise<{ delivered: boolean; emailed: boolean }> {
  const { sleeperLeagueId, alert, recipient } = args
  const emailKey = sentClaimKey(sleeperLeagueId, alert, 'email', recipient.id)
  const emailClaim = await claimSend(emailKey)
  const needEmail = emailClaim !== 'taken'

  const pushGate = await decidePushForUser(recipient.id, {
    category: args.pushCategory,
    leagueId: args.leagueRowId,
    severity: 'medium',
  }).catch(() => null)
  const pushKey = sentClaimKey(sleeperLeagueId, alert, 'push', recipient.id)
  const pushClaim: ClaimResult = pushGate?.allowed ? await claimSend(pushKey) : 'taken'
  const needPush = pushClaim !== 'taken'

  if (!needEmail && !needPush) return { delivered: true, emailed: false }

  let message: { subject: string; html: string }
  try {
    message = await args.compose()
  } catch (err) {
    console.warn('[trade-notify] alert not composed — owed, retried next sweep', {
      sleeperLeagueId,
      alert: owedKey(alert),
      name: err instanceof Error ? err.name : typeof err,
    })
    if (emailClaim === 'ours') await releaseSend(emailKey)
    if (pushClaim === 'ours') await releaseSend(pushKey)
    return { delivered: false, emailed: false }
  }

  let emailed = false
  if (needEmail) {
    const sent = await sendTemplatedEmail({ to: recipient.email, subject: message.subject, html: message.html }).catch(
      () => ({ ok: false as const }),
    )
    emailed = sent.ok
    if (!sent.ok && emailClaim === 'ours') await releaseSend(emailKey)
  }
  if (needPush) {
    await sendPushToUser(recipient.id, args.push(message.subject)).catch(() => [])
  }
  return { delivered: !needEmail || emailed, emailed }
}

/**
 * Tell the managers IN an open offer that it is waiting on them.
 *
 * ⚠ ONLY THE MANAGERS IN IT, AND NOT THE ONE WHO SENT IT. Guap's call (2026-09-24): an offer is a
 * request to a specific person; the rest of the league hears about it when it completes, with the
 * grades. The proposer already knows what they proposed.
 *
 * ⚠ "IN IT" IS DECIDED EXACTLY AS THE LEAGUE'S TRADES PANEL DECIDES IT — the claimed team's
 * platform id on the recipient's own row, else the Sleeper id on their profile, then the Sleeper
 * roster that id owns. A looser rule would alert someone the league page then shows nothing to,
 * which is the email-says-yes, page-says-no failure this change exists to remove.
 *
 * `delivered` lists the offers every manager in them now has; the rest stay owed.
 */
async function notifyOffers(args: {
  sleeperLeagueId: string
  offers: FeedTrade[]
  afLeagues: AfLeagueRow[]
  recipients: Recipient[]
  rowFor: (userId: string) => AfLeagueRow
  tradeUrl: (rowId: string, transactionId: string) => string
  unsubscribeUrlFor: (email: string) => string
}): Promise<{ emailsSent: number; delivered: string[]; error?: string }> {
  const { sleeperLeagueId, offers, afLeagues, recipients, rowFor, tradeUrl, unsubscribeUrlFor } = args
  const rosters: SleeperRoster[] | null = await fetchLeagueRosters(sleeperLeagueId)
  if (!rosters || rosters.length === 0) {
    // Owed, not lost: the next sweep retries while the offer is still open.
    return { emailsSent: 0, delivered: [], error: 'rosters unavailable — offer owed, retried next sweep' }
  }

  /*
   * Every AF user attached to any copy of this league — not only the email recipients — because
   * the DM half below needs both managers' accounts whether or not either takes trade emails.
   */
  const { attachedUserIds, sleeperIdOf } = await sleeperIdResolver(afLeagues, recipients, rowFor)
  const rosterIdOf = (sleeperId: string): number | null => {
    const roster = rosters.find((r) => String(r.owner_id ?? '') === sleeperId)
    return roster && Number.isFinite(Number(roster.roster_id)) ? Number(roster.roster_id) : null
  }

  // Names are decoration: an unavailable directory costs a label, never the alert.
  const isNfl = String(afLeagues[0].sport ?? 'NFL').toUpperCase() === 'NFL'
  const players = (isNfl ? await getAllPlayers().catch(() => ({})) : {}) as Record<string, SleeperPlayerRow>
  const users = (await getLeagueUsers(sleeperLeagueId).catch(() => [])) as SleeperUserRow[]
  const proposerNameOf = (creator: string | null): string | null => {
    if (!creator) return null
    const u = users.find((row) => row.user_id === creator)
    return u?.metadata?.team_name?.trim() || u?.display_name?.trim() || null
  }
  const sleeperLink = resolveSourceScreenLink({ platform: 'sleeper', sourceLeagueId: sleeperLeagueId, screen: 'trade' })
  const sleeperUrl = sleeperLink?.verified ? sleeperLink.href : null

  let emailsSent = 0
  const delivered: string[] = []
  for (const offer of offers) {
    let everyoneHasIt = true
    for (const recipient of recipients) {
      const sleeperId = sleeperIdOf(recipient.id)
      if (!sleeperId || sleeperId === offer.creator) continue
      const rosterId = rosterIdOf(sleeperId)
      if (rosterId == null || !offer.rosterIds.includes(rosterId)) continue

      const row = rowFor(recipient.id)
      const leagueName = row.name ?? afLeagues[0].name ?? 'your league'
      const href = tradeUrl(row.id, offer.id)
      const outcome = await deliverToRecipient({
        sleeperLeagueId,
        alert: { kind: 'offer', id: offer.id },
        recipient,
        leagueRowId: row.id,
        pushCategory: 'trade_proposals',
        push: (subject) => ({
          title: `Trade offer in ${leagueName}`,
          body: subject,
          href,
          tag: `trade:${row.id}:${offer.id}`,
          type: 'trade',
          leagueId: row.id,
        }),
        compose: async () => {
          const { assetsGiven, assetsReceived } = buildTradeAssetsForRoster({ tx: offer.tx, userRosterId: rosterId, players })
          /*
           * THE grade the /core Trades inbox shows for this offer: the recipient's own row, their side,
           * their roster need (`viewerSide: true`) — `lib/core-app/trades.ts` runs exactly this pair. A
           * grade that cannot be computed withholds its letter; the alert still goes.
           */
          const grader = await createLeagueTradeGrader({ leagueId: row.id, userId: recipient.id }).catch(() => null)
          const grade = await gradeDeal(grader, {
            give: gradeInputsFromPending(assetsGiven),
            get: gradeInputsFromPending(assetsReceived),
            viewerSide: true,
          }).catch(() => null)
          return buildPendingTradeOfferEmail({
            leagueName,
            proposerName: proposerNameOf(offer.creator),
            youGet: assetsReceived,
            youGive: assetsGiven,
            reviewUrl: `${getBaseUrl()}${href}`,
            sleeperUrl,
            grade,
            leagueType: grade?.leagueType ?? grader?.leagueType ?? null,
            confirmUrl: confirmUrlFor(row.id),
            baseUrl: getBaseUrl(),
            leagueId: row.id,
            unsubscribeUrl: unsubscribeUrlFor(recipient.email),
          })
        },
      })
      if (outcome.emailed) emailsSent += 1
      if (!outcome.delivered) everyoneHasIt = false
    }
    if (everyoneHasIt) delivered.push(offer.id)

    await postOfferToManagersDm({
      sleeperLeagueId,
      offer,
      rosters,
      players,
      users,
      afLeagues,
      attachedUserIds,
      sleeperIdOf,
      rosterIdOf,
      rowFor,
      tradeUrl,
    }).catch((e: unknown) => {
      console.warn('[trade-notify] offer DM skipped', {
        sleeperLeagueId,
        name: e && typeof e === 'object' && 'name' in e ? String((e as { name: unknown }).name) : typeof e,
      })
    })
  }
  return { emailsSent, delivered }
}

/**
 * The offer, posted into the DM between the two managers in it — ONLY when both are AllFantasy
 * users attached to a copy of this league. A manager who is only on Sleeper has no DM to receive
 * it, and we never open a conversation with someone who is not here (owner's rule, 2026-09-25).
 *
 * Once per offer, by the claim row in lib/chat-notifications/tradeOfferDm.ts; this sweep only
 * sees each offer as new once anyway, so the claim is the second guard, not the first.
 *
 * ⚠ TWO ROSTERS ONLY, and each manager's link goes to their OWN copy of the league (`rowFor`),
 * for the same reason the emails above do.
 */
async function postOfferToManagersDm(args: {
  sleeperLeagueId: string
  offer: FeedTrade
  rosters: SleeperRoster[]
  players: Record<string, SleeperPlayerRow>
  users: SleeperUserRow[]
  afLeagues: AfLeagueRow[]
  attachedUserIds: string[]
  sleeperIdOf: (userId: string) => string | null
  rosterIdOf: (sleeperId: string) => number | null
  rowFor: (userId: string) => AfLeagueRow
  tradeUrl: (rowId: string, transactionId: string) => string
}): Promise<void> {
  const { offer } = args
  if (!offer.creator || offer.rosterIds.length !== 2) return
  const proposerRosterId = args.rosterIdOf(offer.creator)
  if (proposerRosterId == null || !offer.rosterIds.includes(proposerRosterId)) return
  const receiverRosterId = offer.rosterIds.find((id) => id !== proposerRosterId)
  const receiverSleeperId = String(args.rosters.find((r) => Number(r.roster_id) === receiverRosterId)?.owner_id ?? '')
  if (receiverRosterId == null || !receiverSleeperId) return

  const afUserFor = (sleeperId: string): string | null =>
    args.attachedUserIds.find((userId) => args.sleeperIdOf(userId) === sleeperId) ?? null
  const proposerUserId = afUserFor(offer.creator)
  const receiverUserId = afUserFor(receiverSleeperId)
  if (!proposerUserId || !receiverUserId || proposerUserId === receiverUserId) return

  const { postImportedOfferToDm, providerAssetLabel } = await import('@/lib/chat-notifications/tradeOfferSources')
  const { safeDisplayName } = await import('@/lib/chat-notifications/displayName')
  const nameOf = (sleeperId: string): string => {
    const u = args.users.find((row) => row.user_id === sleeperId)
    return safeDisplayName([u?.metadata?.team_name, u?.display_name], 'A league mate')
  }
  // From the proposer's side: what they give, and what they get (= what the other side gives).
  const { assetsGiven, assetsReceived } = buildTradeAssetsForRoster({
    tx: offer.tx,
    userRosterId: proposerRosterId,
    players: args.players,
  })
  const proposerRow = args.rowFor(proposerUserId)
  const receiverRow = args.rowFor(receiverUserId)
  await postImportedOfferToDm({
    provider: 'sleeper',
    providerLeagueId: args.sleeperLeagueId,
    transactionId: offer.id,
    leagueId: proposerRow.id,
    leagueName: proposerRow.name ?? args.afLeagues[0].name ?? null,
    proposer: {
      userId: proposerUserId,
      manager: nameOf(offer.creator),
      gives: assetsGiven.map(providerAssetLabel),
      href: args.tradeUrl(proposerRow.id, offer.id),
    },
    receiver: {
      userId: receiverUserId,
      manager: nameOf(receiverSleeperId),
      gives: assetsReceived.map(providerAssetLabel),
      href: args.tradeUrl(receiverRow.id, offer.id),
    },
    directionKnown: true,
    createdAt: typeof offer.createdMs === 'number' && offer.createdMs > 0 ? new Date(offer.createdMs).toISOString() : null,
  })
}

/**
 * A completed trade whose offer we posted into a DM gets its "accepted" line there. Reads one
 * claim row per completion and nothing else; a trade that never had a DM card is a no-op.
 */
async function announceCompletionsInDms(sleeperLeagueId: string, completions: string[]): Promise<void> {
  try {
    const [{ postTradeStatusToDm }, { importedTradeId }] = await Promise.all([
      import('@/lib/chat-notifications/tradeOfferDm'),
      import('@/lib/chat-notifications/tradeOfferSources'),
    ])
    for (const transactionId of completions) {
      await postTradeStatusToDm({
        source: 'sleeper',
        tradeId: importedTradeId(sleeperLeagueId, transactionId),
        status: 'accepted',
      }).catch(() => null)
    }
  } catch {
    /* A DM line is never worth failing the sweep over. */
  }
}

/** Sweep every imported Sleeper league (bounded), one contained result each. */
/**
 * Where the last sweep stopped, so the next one starts after it.
 *
 * One cache row for the whole job. The alternative — stamping a "last checked" on every league —
 * would cost 50 upserts per run, 14,400 a day, to store something one row can hold.
 */
const CURSOR_KEY = 'trade-notify:cursor:v1'
const CURSOR_TTL_MS = 30 * 24 * 60 * 60 * 1000

async function readCursor(): Promise<string> {
  const row = await prisma.sportsDataCache
    .findUnique({ where: { cacheKey: CURSOR_KEY } })
    .catch(() => null)
  const after = (row?.data as { after?: unknown } | null)?.after
  return typeof after === 'string' ? after : ''
}

async function writeCursor(after: string): Promise<void> {
  await prisma.sportsDataCache
    .upsert({
      where: { cacheKey: CURSOR_KEY },
      update: { data: { after }, expiresAt: new Date(Date.now() + CURSOR_TTL_MS) },
      create: { cacheKey: CURSOR_KEY, data: { after }, expiresAt: new Date(Date.now() + CURSOR_TTL_MS) },
    })
    .catch(() => undefined)
}

/**
 * Sweep every Sleeper league, a page at a time.
 *
 * 🛑 THIS USED TO TAKE 50 WITH NO `orderBy` AND NO CURSOR, WHICH IS NOT A SAMPLE — IT IS THE SAME
 * 50 FOREVER. Measured on production 2026-09-05: 202 distinct Sleeper leagues, `take: 50`, and the
 * returned order byte-identical across calls. So 152 leagues — 75% of them — had never been checked
 * by ANY of the 1,610 runs this job has recorded, and never would be. The job reported `success`
 * every time, because it did exactly what it was asked.
 *
 * ⚠ THE PAGE SIZE IS DELIBERATELY UNCHANGED. Raising it to cover everything in one run is the
 * obvious move and the wrong one: `scripts/cron-fast-tier-loop.mjs` already records this job at p99
 * 359s against its own 300s maxDuration, so a 4x page would trade a coverage bug for a timeout.
 * Keyset pagination keeps each run the same size it is today and covers all 202 in ~5 runs, about
 * 25 minutes at the 300s cadence.
 *
 * ⚠ KEYSET, NOT OFFSET. `skip`/`take` drifts when a league is added or removed mid-cycle — rows
 * shift under the offset and one gets silently skipped. Ordering by `platformLeagueId` and asking
 * for the next ids greater than the last one processed cannot skip a row, only revisit one.
 */
export async function detectAndNotifyAll(limit = 50, priorityLimit = 0): Promise<LeagueNotifyResult[]> {
  const after = await readCursor()
  const page = async (from: string) =>
    prisma.league.findMany({
      where: { platform: 'sleeper', platformLeagueId: { not: '', gt: from } },
      select: { platformLeagueId: true },
      distinct: ['platformLeagueId'],
      orderBy: { platformLeagueId: 'asc' },
      take: limit,
    })

  let leagues = await page(after)
  /*
   * The tail is shorter than a page, so the cycle ends here and the next run starts over. Wrapping
   * inside this run rather than next time keeps a full page of work per fire even at the boundary.
   */
  if (leagues.length === 0 && after !== '') leagues = await page('')

  /*
   * Recently opened leagues are the latency lane. The cursor still guarantees
   * eventual coverage for every imported league, while this small second query
   * makes the leagues people are using today run on every fifteen-minute fire.
   * `distinct` keeps duplicate season rows from spending the budget twice.
   */
  const priority = priorityLimit > 0
    ? await prisma.league.findMany({
        where: { platform: 'sleeper', platformLeagueId: { not: '' }, lastViewedAt: { not: null } },
        select: { platformLeagueId: true },
        distinct: ['platformLeagueId'],
        orderBy: { lastViewedAt: 'desc' },
        take: priorityLimit,
      }).catch(() => [] as Array<{ platformLeagueId: string }>)
    : []
  const work = [...new Map([...priority, ...leagues].map((league) => [league.platformLeagueId, league])).values()]

  const results: LeagueNotifyResult[] = []
  for (const l of work) {
    if (!l.platformLeagueId) continue
    results.push(await detectAndNotifyLeague(l.platformLeagueId))
  }

  /*
   * A short page means the end of the list: reset so the next run wraps. The cursor advances even
   * when a league errors, because a league that fails every time must not wedge the cycle and
   * starve the other 201 — the exact failure this change exists to remove.
   */
  const last = leagues.at(-1)?.platformLeagueId ?? ''
  await writeCursor(leagues.length < limit ? '' : last)

  return results
}
