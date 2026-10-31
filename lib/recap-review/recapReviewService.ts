import 'server-only'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  DRAFT_PREFIX,
  DRAFT_TTL_MS,
  draftKey,
  draftLeaguePrefix,
  draftText,
  newDraft,
  readDraft,
  readRecapReview,
  shouldAutoPost,
  type RecapDraft,
} from './recapReview'

/**
 * Weekly recap review — storage and posting. Rules in ./recapReview.
 *
 * ⚠ DRAFTS LIVE IN `sportsDataCache`, KEYED PER LEAGUE PER WEEK, AND ARE CLAIMED WITH A
 * PRIMARY-KEY INSERT. The Tuesday cron fires three times; the second and third find the draft
 * already there and do nothing — never overwriting a commissioner's half-finished edit, never
 * re-notifying, and never posting a week the commissioner discarded. Same claim pattern the Chimmy
 * moment dedupe uses (lib/league-chat/chimmyMoments.ts).
 *
 * ⚠ POSTING GOES THROUGH THE SAME FUNCTIONS THE CRON USES, so the once-per-week Chimmy-moment
 * dedupe (and the legacy Sleeper key) still hold: a draft can never post next to an auto-posted
 * recap for the same week.
 */

async function commissionerIds(leagueId: string): Promise<string[]> {
  const [league, teams] = await Promise.all([
    prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true } }),
    prisma.leagueTeam.findMany({
      where: { leagueId, claimedByUserId: { not: null }, OR: [{ isCommissioner: true }, { isCoCommissioner: true }] },
      select: { claimedByUserId: true },
    }),
  ])
  const ids = new Set<string>()
  if (league?.userId) ids.add(league.userId)
  for (const t of teams) if (t.claimedByUserId) ids.add(t.claimedByUserId)
  return [...ids]
}

/** True when this league wants recaps held for review. Read off the settings the cron already has. */
export function recapReviewOn(settings: unknown): boolean {
  return readRecapReview(settings).mode === 'review'
}

/**
 * Hold a generated recap as a draft. Returns 'held' the first time for a week and 'exists' after —
 * the cron's later fires, a discarded week, or a draft already posted.
 */
export async function holdRecapDraft(
  input: Omit<RecapDraft, 'version' | 'editedText' | 'editedBy' | 'status' | 'closedAt' | 'closedBy' | 'autoPosted' | 'generatedAt'>,
  now = new Date(),
): Promise<'held' | 'exists'> {
  const draft = newDraft(input, now)
  const res = await prisma.sportsDataCache.createMany({
    data: [{ cacheKey: draftKey(input.leagueId, input.season, input.week), data: draft as unknown as Prisma.InputJsonValue, expiresAt: new Date(now.getTime() + DRAFT_TTL_MS) }],
    skipDuplicates: true,
  })
  if (res.count === 0) return 'exists'
  try {
    const { dispatchNotification } = await import('@/lib/notifications/NotificationDispatcher')
    await dispatchNotification({
      userIds: await commissionerIds(input.leagueId),
      category: 'commissioner_alerts',
      type: 'weekly_recap_review',
      title: `Week ${input.week} recap is ready for you`,
      body: `${input.leagueName}: review it, edit anything, then post it to league chat.`,
      actionHref: `/core/commissioner?league=${encodeURIComponent(input.leagueId)}#ch-recap`,
      actionLabel: 'Review recap',
      leagueId: input.leagueId,
      severity: 'medium',
      dedupePrefix: `recap-review:${input.leagueId}:${input.season}:${input.week}`,
    })
  } catch (e) {
    console.warn('[recap-review] notification failed', e instanceof Error ? e.message : e)
  }
  return 'held'
}

async function writeDraft(d: RecapDraft): Promise<void> {
  await prisma.sportsDataCache.update({ where: { cacheKey: draftKey(d.leagueId, d.season, d.week) }, data: { data: d as unknown as Prisma.InputJsonValue } })
}

/** Whether this week already has a draft in any state — the cron skips its Sleeper reads then. */
export async function recapDraftExists(leagueId: string, season: string | number, week: number): Promise<boolean> {
  const row = await prisma.sportsDataCache.findUnique({ where: { cacheKey: draftKey(leagueId, season, week) }, select: { cacheKey: true } })
  return row != null
}

/** The newest draft for the league that is still waiting, if any. */
export async function readPendingDraft(leagueId: string): Promise<RecapDraft | null> {
  const rows = await prisma.sportsDataCache.findMany({
    where: { cacheKey: { startsWith: draftLeaguePrefix(leagueId) }, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { data: true },
  })
  for (const r of rows) {
    const d = readDraft(r.data)
    if (d?.status === 'pending') return d
  }
  return null
}

async function readDraftFor(leagueId: string, season: string, week: number): Promise<RecapDraft | null> {
  const row = await prisma.sportsDataCache.findUnique({ where: { cacheKey: draftKey(leagueId, season, week) }, select: { data: true } })
  return row ? readDraft(row.data) : null
}

export type PostDraftResult = { ok: true } | { ok: false; error: 'not_found' | 'not_pending' | 'already_posted' | 'chimmy_quiet' | 'post_failed' }

async function postText(d: RecapDraft, text: string): Promise<{ posted: boolean; reason?: string }> {
  if (d.sleeperLeagueId) {
    const { postWeeklyRecapAsChimmy } = await import('@/lib/league-chat/weeklyRecapMoment')
    return postWeeklyRecapAsChimmy({ afLeagueId: d.leagueId, sleeperLeagueId: d.sleeperLeagueId, season: d.season, week: d.week, text })
  }
  const { postNativeRecapText } = await import('@/lib/league-chat/nativeWeeklyRecap')
  return postNativeRecapText({ leagueId: d.leagueId, season: d.season, week: d.week, text })
}

/** Post a draft — the commissioner's edit when given, else the stored text. */
export async function postRecapDraft(
  leagueId: string,
  season: string,
  week: number,
  opts: { text?: string | null; actorUserId: string | null; auto?: boolean },
  now = new Date(),
): Promise<PostDraftResult> {
  const d = await readDraftFor(leagueId, season, week)
  if (!d) return { ok: false, error: 'not_found' }
  if (d.status !== 'pending') return { ok: false, error: 'not_pending' }
  const edited = opts.text != null && opts.text !== d.generatedText ? opts.text : d.editedText
  const working: RecapDraft = { ...d, editedText: edited, editedBy: edited !== d.editedText ? opts.actorUserId : d.editedBy }
  const posted = await postText(working, draftText(working))
  if (!posted.posted) {
    // A week already in chat (posted by hand elsewhere, or the old identity) closes the draft.
    if (posted.reason === 'duplicate' || posted.reason === 'already_posted_legacy') {
      await writeDraft({ ...working, status: 'posted', closedAt: now.toISOString(), closedBy: opts.actorUserId })
      return { ok: false, error: 'already_posted' }
    }
    if (edited !== d.editedText) await writeDraft(working)
    return { ok: false, error: posted.reason === 'disabled' ? 'chimmy_quiet' : 'post_failed' }
  }
  await writeDraft({ ...working, status: 'posted', closedAt: now.toISOString(), closedBy: opts.actorUserId, autoPosted: opts.auto === true })
  try {
    const { notifyWeeklyRecaps } = await import('@/lib/league-chat/weeklyRecapNotify')
    const { getBaseUrl } = await import('@/lib/get-base-url')
    await notifyWeeklyRecaps(
      [{ leagueId: d.leagueId, leagueName: d.leagueName, ownerUserId: d.ownerUserId, season: d.season, week: d.week, text: draftText(working) }],
      { email: process.env.WEEKLY_RECAP_EMAIL_ENABLED === '1', baseUrl: getBaseUrl() },
    )
  } catch (e) {
    console.warn('[recap-review] member notify failed', e instanceof Error ? e.message : e)
  }
  return { ok: true }
}

/** Save an edit without posting. */
export async function saveRecapEdit(leagueId: string, season: string, week: number, text: string, actorUserId: string): Promise<boolean> {
  const d = await readDraftFor(leagueId, season, week)
  if (!d || d.status !== 'pending') return false
  await writeDraft({ ...d, editedText: text, editedBy: actorUserId })
  return true
}

export async function discardRecapDraft(leagueId: string, season: string, week: number, actorUserId: string, now = new Date()): Promise<boolean> {
  const d = await readDraftFor(leagueId, season, week)
  if (!d || d.status !== 'pending') return false
  await writeDraft({ ...d, status: 'discarded', closedAt: now.toISOString(), closedBy: actorUserId })
  return true
}

/**
 * The daily commissioner run: post every untouched draft at least 12 h old whose league asked for
 * that. A draft the commissioner edited is left for them — they are mid-way through it.
 */
export async function postUntouchedRecapDrafts(now = new Date()): Promise<{ checked: number; posted: number; failed: number }> {
  const rows = await prisma.sportsDataCache.findMany({
    where: { cacheKey: { startsWith: DRAFT_PREFIX }, expiresAt: { gt: now } },
    select: { data: true },
    take: 500,
  })
  const pending = rows.map((r) => readDraft(r.data)).filter((d): d is RecapDraft => d?.status === 'pending')
  let posted = 0
  let failed = 0
  for (const d of pending) {
    const league = await prisma.league.findUnique({ where: { id: d.leagueId }, select: { settings: true } })
    if (!league || !shouldAutoPost(d, readRecapReview(league.settings), now)) continue
    const r = await postRecapDraft(d.leagueId, d.season, d.week, { actorUserId: null, auto: true }, now)
    if (r.ok) posted++
    else if (r.error !== 'already_posted') failed++
  }
  return { checked: pending.length, posted, failed }
}
