import 'server-only'

import { randomUUID } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { readMedianGameInPlayoffs } from '@/lib/redraft/medianGame'
import { FeatureGateService } from '@/lib/subscription/FeatureGateService'
import { isPollClosed, readViewerPoll } from '@/lib/chat-core/messagePolls'
import {
  AMENDMENT_TEXT_MAX,
  AMENDMENT_TITLE_MAX,
  DECLINE_REASON_MAX,
  NO,
  OPEN_AMENDMENTS_MAX,
  PENDING_PER_MEMBER_MAX,
  YES,
  amendmentPollQuestion,
  ruleLogEntry,
  voteReminderDue,
  voteReminderText,
  buildConstitution,
  constitutionText,
  describeChange,
  parseAnswers,
  parseSettingChange,
  parseSections,
  pruneAmendments,
  readAmendments,
  readyToApply,
  resolveAmendment,
  type Amendment,
  type ConstitutionAnswers,
  type ConstitutionSection,
  type LeagueFacts,
  type RuleLogEntry,
} from './constitutionBuilder'

/**
 * Constitution builder — storage, votes and applying amendments. Rules live in ./constitutionBuilder.
 *
 * ── Where things live (no migration) ────────────────────────────────────
 *   versions    one `LeagueStoryline` row per published version, storyType 'constitution', season =
 *               the league's season, metadata { version, sections, answers, publishedBy, source }.
 *               The league page already shows the newest 'constitution' storyline
 *               (`buildConstitutionCard`), so publishing updates it with no new read path. The
 *               creation-time stub (`generateLeagueConstitutionArtifact`) writes season = null, so
 *               its upsert can never overwrite a published version.
 *   answers     `League.settings.constitution_answers`
 *   amendments  `League.settings.constitution_amendments` — small rows; the vote itself is a
 *               league-chat poll, so members vote where they already talk.
 *
 * ── Tiers (spec §0: Free gets the manual version of every automation) ───
 *   Free          read, write and publish by hand, version history, propose amendments and run the
 *                 league vote, apply a passed amendment by hand
 *   Commissioner  "Build from my settings" (`commissioner_constitution_generator`), and passed
 *                 next-season amendments applied automatically when the season is finalized
 *
 * ⚠ AN AMENDMENT IS APPLIED THROUGH `executeLeagueSettingsPatch`, THE SAME CHOKE POINT AS THE
 * SETTINGS SCREEN, so every check there (commissioner role, mid-season structural refusal,
 * premium keys) still holds. A refusal is recorded on the amendment as `apply_failed` with the
 * route's reason, never swallowed.
 */

export const CONSTITUTION_FEATURE = 'commissioner_constitution_generator'
const ANSWERS_KEY = 'constitution_answers'
const AMENDMENTS_KEY = 'constitution_amendments'

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

export async function constitutionEntitled(userId: string | null): Promise<boolean> {
  if (!userId) return false
  try {
    return (await new FeatureGateService().evaluateUserFeatureAccess(userId, CONSTITUTION_FEATURE)).allowed
  } catch (e) {
    console.warn('[constitution] plan check failed; treating as no plan', e instanceof Error ? e.message : e)
    return false
  }
}

async function updateSettingsLocked(leagueId: string, mutate: (settings: Record<string, unknown>) => Record<string, unknown> | null) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$queryRaw`SELECT id FROM leagues WHERE id = ${leagueId} FOR UPDATE`
    const league = await tx.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
    if (!league) return false
    const next = mutate(asRecord(league.settings))
    if (!next) return true
    await tx.league.update({ where: { id: leagueId }, data: { settings: next as Prisma.InputJsonValue } })
    return true
  })
}

async function audit(leagueId: string, userId: string | null, actionType: string, afterState: unknown) {
  try {
    await prisma.leagueAuditLog.create({
      data: { leagueId, userId, actionType, entityType: 'league_constitution', afterState: afterState as Prisma.InputJsonValue },
    })
  } catch (e) {
    console.warn('[constitution] audit write failed', e instanceof Error ? e.message : e)
  }
}

export async function readLeagueFacts(leagueId: string): Promise<LeagueFacts | null> {
  const l = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      name: true, sport: true, season: true, platform: true, leagueType: true, isDynasty: true, leagueSize: true,
      rosterSize: true, scoring: true, waiverType: true, waiverBudget: true, waiverMinBid: true, tradeReviewHours: true,
      tradeDeadlineWeek: true, draftPickTrading: true, playoffTeams: true, playoffStartWeek: true, medianGame: true,
      irSlots: true, taxiSlots: true, keeperCount: true, keeperMaxYears: true, keeperRoundPenalty: true,
      keeperMissedDeadlineRule: true, settings: true,
    },
  })
  if (!l) return null
  const settings = asRecord(l.settings)
  const dues = asRecord(settings.dues_tracker)
  const { settings: _settings, ...cols } = l // eslint-disable-line @typescript-eslint/no-unused-vars
  return {
    ...cols,
    name: l.name ?? 'This league',
    sport: String(l.sport),
    medianGameInPlayoffs: readMedianGameInPlayoffs(settings),
    tradeReviewMode: typeof settings.trade_review_mode === 'string' ? settings.trade_review_mode : null,
    dues: dues.enabled === true && typeof dues.amount === 'number' ? { amount: dues.amount, currency: typeof dues.currency === 'string' ? dues.currency : 'USD' } : null,
  }
}

// ── Versions ────────────────────────────────────────────────────────────────

export type ConstitutionVersion = {
  id: string
  version: number
  sections: ConstitutionSection[]
  publishedAt: string
  publishedBy: string | null
  source: 'builder' | 'manual'
}

async function readVersions(leagueId: string): Promise<ConstitutionVersion[]> {
  const rows = await prisma.leagueStoryline.findMany({
    where: { leagueId, storyType: 'constitution', NOT: { season: null } },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: { id: true, metadata: true, createdAt: true },
  })
  const out: ConstitutionVersion[] = []
  for (const r of rows) {
    const m = asRecord(r.metadata)
    const sections = parseSections(m.sections)
    if (!sections || typeof m.version !== 'number') continue
    out.push({
      id: r.id,
      version: m.version,
      sections,
      publishedAt: r.createdAt.toISOString(),
      publishedBy: typeof m.publishedBy === 'string' ? m.publishedBy : null,
      source: m.source === 'builder' ? 'builder' : 'manual',
    })
  }
  return out
}

/** Commissioner plan: the constitution written from this league's settings and the answers given. */
export async function draftFromSettings(leagueId: string, answers: unknown): Promise<ConstitutionSection[] | null> {
  const facts = await readLeagueFacts(leagueId)
  return facts ? buildConstitution(facts, parseAnswers(answers)) : null
}

export async function publishVersion(
  leagueId: string,
  userId: string,
  input: { sections: unknown; answers?: unknown; source?: unknown },
): Promise<{ ok: true; version: number } | { ok: false; error: 'invalid_sections' | 'not_found' }> {
  const sections = parseSections(input.sections)
  if (!sections) return { ok: false, error: 'invalid_sections' }
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { name: true, season: true } })
  if (!league) return { ok: false, error: 'not_found' }
  const answers = parseAnswers(input.answers)
  const version = ((await readVersions(leagueId))[0]?.version ?? 0) + 1
  const source = input.source === 'builder' ? 'builder' : 'manual'
  await prisma.leagueStoryline.create({
    data: {
      leagueId,
      season: league.season,
      storyType: 'constitution',
      title: `${league.name ?? 'League'} constitution — version ${version}`,
      summary: `${sections.length} articles. Changes by league vote; see Article “Changing these rules”.`.slice(0, 300),
      body: constitutionText(sections),
      source: source === 'builder' ? 'deterministic' : 'commissioner',
      metadata: { version, sections, answers, publishedBy: userId, source } as Prisma.InputJsonValue,
    },
  })
  await updateSettingsLocked(leagueId, (s) => ({ ...s, [ANSWERS_KEY]: answers }))
  await audit(leagueId, userId, 'constitution_published', { version, source })
  return { ok: true, version }
}

// ── Amendments ──────────────────────────────────────────────────────────────

async function pollCounts(messageId: string | null, now: Date): Promise<{ yes: number; no: number; closed: boolean } | null> {
  if (!messageId) return null
  const row = await prisma.leagueChatMessage.findUnique({ where: { id: messageId }, select: { metadata: true } })
  const poll = row ? readViewerPoll(row.metadata, null) : null
  if (!poll) return null
  const count = (id: string) => poll.options.find((o) => o.id === id)?.count ?? 0
  return { yes: count(YES), no: count(NO), closed: isPollClosed(poll, now.getTime()) }
}

/**
 * Close every vote whose poll has closed, and apply passed amendments that take effect now.
 * Lazy: runs whenever the constitution is read. A poll that disappeared (message deleted) fails the
 * vote rather than leaving it open forever.
 */
export async function resolveAmendments(leagueId: string, now = new Date()): Promise<Amendment[]> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true, userId: true } })
  if (!league) return []
  const current = readAmendments(asRecord(league.settings)[AMENDMENTS_KEY])
  const voting = current.filter((a) => a.status === 'voting')
  if (voting.length === 0) return current
  const resolved = new Map<string, Amendment>()
  for (const a of voting) {
    const counts = await pollCounts(a.pollMessageId, now)
    const next = counts
      ? resolveAmendment(a, counts, now)
      : Date.parse(a.closesAt) <= now.getTime()
        ? { ...a, status: 'failed' as const, resolvedAt: now.toISOString(), applyError: 'The vote’s poll could not be read.' }
        : a
    if (next !== a) resolved.set(a.id, next)
  }
  if (resolved.size === 0) return current
  let merged = current
  await updateSettingsLocked(leagueId, (s) => {
    merged = readAmendments(s[AMENDMENTS_KEY]).map((a) => (a.status === 'voting' && resolved.has(a.id) ? resolved.get(a.id)! : a))
    return { ...s, [AMENDMENTS_KEY]: merged }
  })
  for (const a of resolved.values()) await audit(leagueId, null, `amendment_${a.status}`, { id: a.id, title: a.title, yes: a.yes, no: a.no })
  // Passed + effective now, on the Commissioner plan: applied on behalf of the league owner, who
  // runs the settings patch. Without the plan it stays `passed` for the commissioner to apply.
  const autoApply = readyToApply(merged, 'now').filter((a) => resolved.has(a.id))
  if (autoApply.length > 0 && league.userId && (await constitutionEntitled(league.userId))) {
    for (const a of autoApply) await applyAmendment(leagueId, a.id, league.userId)
  }
  return readAmendments(asRecord((await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } }))?.settings)[AMENDMENTS_KEY])
}

export type ProposeError = 'title_required' | 'invalid_change' | 'too_many_open' | 'too_many_pending' | 'not_found' | 'poll_failed'

/** The setting's value right now, for the "11 → 13" preview. Undefined when there is no setting change. */
async function currentValueOf(leagueId: string, key: string | undefined): Promise<number | boolean | string | null | undefined> {
  if (!key) return undefined
  const row = (await prisma.league.findUnique({ where: { id: leagueId }, select: { [key]: true } as never }).catch(() => null)) as Record<string, unknown> | null
  const v = row?.[key]
  return typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string' ? v : null
}

async function notify(userIds: Array<string | null | undefined>, n: { type: string; title: string; body: string; leagueId: string }) {
  const ids = [...new Set(userIds.filter((u): u is string => typeof u === 'string' && u.length > 0))]
  if (ids.length === 0) return
  try {
    const { dispatchNotification } = await import('@/lib/notifications/NotificationDispatcher')
    await dispatchNotification({
      userIds: ids,
      category: 'league_announcements',
      productType: 'app',
      type: n.type,
      title: n.title,
      body: n.body,
      actionHref: `/league/${encodeURIComponent(n.leagueId)}/constitution`,
      actionLabel: 'Open the constitution',
      meta: { leagueId: n.leagueId },
      severity: 'low',
    } as never)
  } catch (e) {
    console.warn('[constitution] notify failed', e instanceof Error ? e.message : e)
  }
}

/** Posts the league-chat poll and starts the clock. Returns the amendment with its poll, or null. */
async function openVote(leagueId: string, actorUserId: string, a: Amendment, voteDays: number, now: Date): Promise<Amendment | null> {
  const amendment: Amendment = { ...a, status: 'voting', closesAt: new Date(now.getTime() + voteDays * 86_400_000).toISOString(), pollMessageId: null }
  const question = amendmentPollQuestion(amendment)
  try {
    const { createLeagueChatMessage } = await import('@/lib/league-chat/LeagueChatMessageService')
    const msg = await createLeagueChatMessage(leagueId, actorUserId, `${question}${amendment.text ? `\n${amendment.text}` : ''}`, {
      idempotencyKey: `amendment-poll:${amendment.id}`,
      type: 'poll',
      source: null,
      metadata: {
        kind: 'constitution_amendment',
        amendmentId: amendment.id,
        poll: {
          question,
          options: [
            { id: YES, text: 'Yes', votes: [] },
            { id: NO, text: 'No', votes: [] },
          ],
          closeAt: amendment.closesAt,
          allowMultiple: false,
          anonymous: false,
        },
      },
    })
    amendment.pollMessageId = (msg as { id?: string } | null)?.id ?? `amendment-poll:${amendment.id}`
    return amendment
  } catch (e) {
    console.warn('[constitution] amendment poll failed', e instanceof Error ? e.message : e)
    return null
  }
}

/**
 * A rule change. From a commissioner it opens the league vote at once. From a member it waits for the
 * commissioner (`pending_approval`), who approves it — the vote opens then — or declines it with a
 * reason. `asCommissioner` defaults to true so existing callers keep their behaviour.
 */
export async function proposeAmendment(
  leagueId: string,
  userId: string,
  body: { title?: unknown; text?: unknown; change?: unknown; effective?: unknown },
  now = new Date(),
  opts: { asCommissioner?: boolean } = {},
): Promise<{ ok: true; amendment: Amendment } | { ok: false; error: ProposeError }> {
  const asCommissioner = opts.asCommissioner !== false
  const title = typeof body.title === 'string' ? body.title.trim().slice(0, AMENDMENT_TITLE_MAX) : ''
  if (!title) return { ok: false, error: 'title_required' }
  const change = parseSettingChange(body.change)
  if (change === 'invalid') return { ok: false, error: 'invalid_change' }
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true, season: true, userId: true } })
  if (!league) return { ok: false, error: 'not_found' }
  const settings = asRecord(league.settings)
  const existing = readAmendments(settings[AMENDMENTS_KEY])
  if (asCommissioner && existing.filter((a) => a.status === 'voting').length >= OPEN_AMENDMENTS_MAX) {
    return { ok: false, error: 'too_many_open' }
  }
  if (!asCommissioner && existing.filter((a) => a.status === 'pending_approval' && a.proposedBy === userId).length >= PENDING_PER_MEMBER_MAX) {
    return { ok: false, error: 'too_many_pending' }
  }
  const answers: ConstitutionAnswers = parseAnswers(settings[ANSWERS_KEY])
  const effective = body.effective === 'now' ? 'now' : 'next_season'
  const previousValue = change ? await currentValueOf(leagueId, change.key) : undefined
  const draft: Amendment = {
    id: randomUUID(),
    title,
    text: typeof body.text === 'string' ? body.text.trim().slice(0, AMENDMENT_TEXT_MAX) : '',
    change,
    effective,
    effectiveSeason: effective === 'next_season' && typeof league.season === 'number' ? league.season + 1 : null,
    ...(previousValue !== undefined ? { previousValue } : {}),
    threshold: answers.amendmentThreshold,
    pollMessageId: null,
    closesAt: now.toISOString(),
    status: 'pending_approval',
    yes: null,
    no: null,
    proposedBy: userId,
    proposedByRole: asCommissioner ? 'commissioner' : 'member',
    proposedAt: now.toISOString(),
    resolvedAt: null,
    appliedAt: null,
    applyError: null,
  }
  const changeText = change ? describeChange(change) : null

  if (!asCommissioner) {
    await updateSettingsLocked(leagueId, (s) => ({ ...s, [AMENDMENTS_KEY]: pruneAmendments([draft, ...readAmendments(s[AMENDMENTS_KEY])]) }))
    await audit(leagueId, userId, 'amendment_submitted', { id: draft.id, title, change: changeText })
    let coCommissioners: Array<string | null> = []
    try {
      const rows = await prisma.leagueTeam.findMany({ where: { leagueId, isCoCommissioner: true }, select: { claimedByUserId: true } })
      coCommissioners = rows.map((r) => r.claimedByUserId)
    } catch {
      coCommissioners = []
    }
    await notify([league.userId, ...coCommissioners], {
      type: 'constitution_amendment_submitted',
      title: 'A rule change is waiting for you',
      body: `A member proposed "${title}". Approve it to open the league vote, or decline it.`,
      leagueId,
    })
    return { ok: true, amendment: draft }
  }

  const amendment = await openVote(leagueId, userId, draft, answers.voteDays, now)
  if (!amendment) return { ok: false, error: 'poll_failed' }
  await updateSettingsLocked(leagueId, (s) => ({ ...s, [AMENDMENTS_KEY]: pruneAmendments([amendment, ...readAmendments(s[AMENDMENTS_KEY])]) }))
  await audit(leagueId, userId, 'amendment_proposed', { id: amendment.id, title, change: changeText })
  return { ok: true, amendment }
}

export type ReviewError = 'not_found' | 'not_pending' | 'too_many_open' | 'poll_failed'

/** Commissioner: open the league vote on a member's proposal. */
export async function approveAmendment(leagueId: string, userId: string, amendmentId: string, now = new Date()): Promise<{ ok: true; amendment: Amendment } | { ok: false; error: ReviewError }> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  if (!league) return { ok: false, error: 'not_found' }
  const settings = asRecord(league.settings)
  const list = readAmendments(settings[AMENDMENTS_KEY])
  const a = list.find((x) => x.id === amendmentId)
  if (!a) return { ok: false, error: 'not_found' }
  if (a.status !== 'pending_approval') return { ok: false, error: 'not_pending' }
  if (list.filter((x) => x.status === 'voting').length >= OPEN_AMENDMENTS_MAX) return { ok: false, error: 'too_many_open' }
  const opened = await openVote(leagueId, userId, a, parseAnswers(settings[ANSWERS_KEY]).voteDays, now)
  if (!opened) return { ok: false, error: 'poll_failed' }
  let applied = false
  await updateSettingsLocked(leagueId, (s) => {
    const current = readAmendments(s[AMENDMENTS_KEY])
    if (!current.some((x) => x.id === amendmentId && x.status === 'pending_approval')) return null
    applied = true
    return { ...s, [AMENDMENTS_KEY]: current.map((x) => (x.id === amendmentId ? opened : x)) }
  })
  if (!applied) return { ok: false, error: 'not_pending' }
  await audit(leagueId, userId, 'amendment_approved', { id: a.id, title: a.title, change: a.change ? describeChange(a.change) : null })
  await notify([a.proposedBy], { type: 'constitution_amendment_approved', title: 'Your rule change is up for a vote', body: `"${a.title}" is open for the league to vote on in league chat.`, leagueId })
  return { ok: true, amendment: opened }
}

/** Commissioner: decline a member's proposal, with a reason the member sees. */
export async function declineAmendment(leagueId: string, userId: string, amendmentId: string, reasonInput: unknown, now = new Date()): Promise<{ ok: true } | { ok: false; error: 'not_found' | 'not_pending' }> {
  const reason = typeof reasonInput === 'string' ? reasonInput.trim().slice(0, DECLINE_REASON_MAX) : ''
  // A holder, not two `let`s: TypeScript cannot see the assignment inside the callback and would narrow them.
  const out: { state: 'ok' | 'not_found' | 'not_pending'; found: Amendment | null } = { state: 'not_found', found: null }
  await updateSettingsLocked(leagueId, (s) => {
    const list = readAmendments(s[AMENDMENTS_KEY])
    const a = list.find((x) => x.id === amendmentId)
    if (!a) return null
    if (a.status !== 'pending_approval') {
      out.state = 'not_pending'
      return null
    }
    out.found = a
    out.state = 'ok'
    return { ...s, [AMENDMENTS_KEY]: list.map((x) => (x.id === amendmentId ? { ...x, status: 'declined' as const, declineReason: reason || null, resolvedAt: now.toISOString() } : x)) }
  })
  if (out.state !== 'ok' || !out.found) return { ok: false, error: out.state === 'not_pending' ? 'not_pending' : 'not_found' }
  const a = out.found
  await audit(leagueId, userId, 'amendment_declined', { id: a.id, title: a.title, reason: reason || null })
  await notify([a.proposedBy], {
    type: 'constitution_amendment_declined',
    title: 'Your rule change was declined',
    body: reason ? `"${a.title}": ${reason}` : `"${a.title}" was declined by the commissioner.`,
    leagueId,
  })
  return { ok: true }
}

export type ApplyError = 'not_found' | 'not_passed' | 'no_change' | 'refused'

/** Apply one passed amendment's setting change through the settings choke point. Free, by hand. */
export async function applyAmendment(leagueId: string, amendmentId: string, actorUserId: string): Promise<{ ok: true } | { ok: false; error: ApplyError; reason?: string }> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true, userId: true } })
  const a = readAmendments(asRecord(league?.settings)[AMENDMENTS_KEY]).find((x) => x.id === amendmentId)
  if (!league || !a) return { ok: false, error: 'not_found' }
  if (a.status !== 'passed' && a.status !== 'apply_failed') return { ok: false, error: 'not_passed' }
  if (!a.change) return { ok: false, error: 'no_change' }

  const { executeLeagueSettingsPatch } = await import('@/lib/league/execute-league-settings-patch')
  // The patch re-checks the commissioner role on the userId it is given; the owner always holds it.
  const res = await executeLeagueSettingsPatch(league.userId ?? actorUserId, { leagueId, [a.change.key]: a.change.value }, { actingUserId: actorUserId })
  const ok = res.status >= 200 && res.status < 300
  const reason = ok ? null : (((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `HTTP ${res.status}`)
  const at = new Date().toISOString()
  await updateSettingsLocked(leagueId, (s) => ({
    ...s,
    [AMENDMENTS_KEY]: readAmendments(s[AMENDMENTS_KEY]).map((x) =>
      x.id === amendmentId ? { ...x, status: ok ? ('applied' as const) : ('apply_failed' as const), appliedAt: ok ? at : null, applyError: reason } : x,
    ),
  }))
  await audit(leagueId, actorUserId, ok ? 'amendment_applied' : 'amendment_apply_failed', { id: a.id, title: a.title, change: describeChange(a.change), reason })
  return ok ? { ok: true } : { ok: false, error: 'refused', reason: reason ?? undefined }
}

/**
 * Commissioner plan: called when a native season is finalized (`finalizeSeasonAndEnterOffseason`).
 * Votes are resolved first, then every passed amendment with a setting change is applied. Never
 * throws — a failed apply is recorded on its amendment and must not fail the season close.
 */
export async function applyAmendmentsAtSeasonRollover(leagueId: string): Promise<{ applied: number; failed: number; skipped: 'no_plan' | null }> {
  try {
    const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true } })
    if (!league?.userId || !(await constitutionEntitled(league.userId))) return { applied: 0, failed: 0, skipped: 'no_plan' }
    const amendments = await resolveAmendments(leagueId)
    let applied = 0
    let failed = 0
    for (const a of readyToApply(amendments, 'season_rollover')) {
      const r = await applyAmendment(leagueId, a.id, league.userId)
      if (r.ok) applied++
      else failed++
    }
    return { applied, failed, skipped: null }
  } catch (e) {
    console.error('[constitution] rollover apply failed', e instanceof Error ? e.message : e)
    return { applied: 0, failed: 0, skipped: null }
  }
}

/**
 * Withdraw an open amendment. A commissioner may withdraw one being voted on or waiting for approval;
 * a member may withdraw only their own proposal that is still waiting.
 */
export async function withdrawAmendment(leagueId: string, userId: string, amendmentId: string, opts: { isCommissioner?: boolean } = {}): Promise<boolean> {
  const isCommissioner = opts.isCommissioner !== false
  let changed: Amendment | null = null
  await updateSettingsLocked(leagueId, (s) => {
    const list = readAmendments(s[AMENDMENTS_KEY])
    const a = list.find((x) => x.id === amendmentId)
    const allowed = a && (isCommissioner ? a.status === 'voting' || a.status === 'pending_approval' : a.status === 'pending_approval' && a.proposedBy === userId)
    if (!a || !allowed) return null
    changed = a
    return { ...s, [AMENDMENTS_KEY]: list.map((x) => (x.id === amendmentId ? { ...x, status: 'withdrawn' as const, resolvedAt: new Date().toISOString() } : x)) }
  })
  if (changed) await audit(leagueId, userId, 'amendment_withdrawn', { id: amendmentId, title: (changed as Amendment).title })
  return changed != null
}

/**
 * Hourly: post a reminder to league chat once, when a vote has less than a day left. Leagues are found
 * by the settings key itself, so a league with no amendments costs nothing.
 */
export async function runAmendmentVoteReminders(now = new Date(), limit = 200): Promise<{ leagues: number; reminded: number; failures: string[] }> {
  const out = { leagues: 0, reminded: 0, failures: [] as string[] }
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM leagues
    WHERE settings ? ${AMENDMENTS_KEY}
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(settings -> ${AMENDMENTS_KEY}) = 'array' THEN settings -> ${AMENDMENTS_KEY} ELSE '[]'::jsonb END) a WHERE a ->> 'status' = 'voting')
    ORDER BY id LIMIT ${limit}`.catch(() => [] as Array<{ id: string }>)
  for (const { id: leagueId } of rows) {
    out.leagues += 1
    try {
      const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true, userId: true } })
      if (!league?.userId) continue
      const due = readAmendments(asRecord(league.settings)[AMENDMENTS_KEY]).filter((a) => voteReminderDue(a, now))
      for (const a of due) {
        const { createLeagueChatMessage } = await import('@/lib/league-chat/LeagueChatMessageService')
        await createLeagueChatMessage(leagueId, league.userId, voteReminderText(a, now), {
          idempotencyKey: `amendment-reminder:${a.id}`,
          type: 'text',
          source: null,
          metadata: { kind: 'constitution_amendment_reminder', amendmentId: a.id },
        } as never)
        await updateSettingsLocked(leagueId, (s) => ({
          ...s,
          [AMENDMENTS_KEY]: readAmendments(s[AMENDMENTS_KEY]).map((x) => (x.id === a.id ? { ...x, reminderSentAt: now.toISOString() } : x)),
        }))
        out.reminded += 1
      }
    } catch (e) {
      out.failures.push(`${leagueId}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return out
}

// ── View ────────────────────────────────────────────────────────────────────

export type ConstitutionView = {
  current: ConstitutionVersion | null
  history: Array<Omit<ConstitutionVersion, 'sections'>>
  answers: ConstitutionAnswers
  amendments: Amendment[]
  entitled: boolean
  isCommissioner: boolean
  /** The viewer, so the page can offer "withdraw" on their own waiting proposal. */
  viewerUserId: string
  /**
   * Every rule change the league has made, newest first — read from the audit log, which is never
   * pruned, so it outlives the 100 amendments kept in settings. Every member sees it.
   */
  log: RuleLogEntry[]
}

async function readRuleLog(leagueId: string, amendments: Amendment[]): Promise<RuleLogEntry[]> {
  // The log is a read-only extra: a failed read shows no log, it never fails the page.
  let rows: Array<{ actionType: string; createdAt: Date; afterState: unknown }> = []
  try {
    rows = await prisma.leagueAuditLog.findMany({
      where: { leagueId, entityType: 'league_constitution' },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { actionType: true, createdAt: true, afterState: true },
    })
  } catch {
    rows = []
  }
  const titleById = new Map(amendments.map((a) => [a.id, a.title]))
  return rows.flatMap((r) => {
    const e = ruleLogEntry({ actionType: r.actionType, createdAt: r.createdAt.toISOString(), afterState: r.afterState }, titleById)
    return e ? [e] : []
  })
}

export async function readConstitutionView(leagueId: string, viewer: { userId: string; isCommissioner: boolean }): Promise<ConstitutionView | null> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true, settings: true } })
  if (!league) return null
  const [versions, amendments, entitled] = await Promise.all([
    readVersions(leagueId),
    resolveAmendments(leagueId),
    viewer.isCommissioner ? constitutionEntitled(league.userId) : Promise.resolve(false),
  ])
  const log = await readRuleLog(leagueId, amendments)
  return {
    viewerUserId: viewer.userId,
    log,
    current: versions[0] ?? null,
    history: versions.map((v) => ({ id: v.id, version: v.version, publishedAt: v.publishedAt, publishedBy: v.publishedBy, source: v.source })),
    answers: parseAnswers(asRecord(league.settings)[ANSWERS_KEY]),
    amendments,
    entitled,
    isCommissioner: viewer.isCommissioner,
  }
}
