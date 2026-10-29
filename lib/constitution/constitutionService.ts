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
  NO,
  OPEN_AMENDMENTS_MAX,
  YES,
  amendmentPollQuestion,
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
  for (const a of resolved.values()) await audit(leagueId, null, `amendment_${a.status}`, { id: a.id, yes: a.yes, no: a.no })
  // Passed + effective now, on the Commissioner plan: applied on behalf of the league owner, who
  // runs the settings patch. Without the plan it stays `passed` for the commissioner to apply.
  const autoApply = readyToApply(merged, 'now').filter((a) => resolved.has(a.id))
  if (autoApply.length > 0 && league.userId && (await constitutionEntitled(league.userId))) {
    for (const a of autoApply) await applyAmendment(leagueId, a.id, league.userId)
  }
  return readAmendments(asRecord((await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } }))?.settings)[AMENDMENTS_KEY])
}

export type ProposeError = 'title_required' | 'invalid_change' | 'too_many_open' | 'not_found' | 'poll_failed'

export async function proposeAmendment(
  leagueId: string,
  userId: string,
  body: { title?: unknown; text?: unknown; change?: unknown; effective?: unknown },
  now = new Date(),
): Promise<{ ok: true; amendment: Amendment } | { ok: false; error: ProposeError }> {
  const title = typeof body.title === 'string' ? body.title.trim().slice(0, AMENDMENT_TITLE_MAX) : ''
  if (!title) return { ok: false, error: 'title_required' }
  const change = parseSettingChange(body.change)
  if (change === 'invalid') return { ok: false, error: 'invalid_change' }
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  if (!league) return { ok: false, error: 'not_found' }
  const settings = asRecord(league.settings)
  if (readAmendments(settings[AMENDMENTS_KEY]).filter((a) => a.status === 'voting').length >= OPEN_AMENDMENTS_MAX) {
    return { ok: false, error: 'too_many_open' }
  }
  const answers: ConstitutionAnswers = parseAnswers(settings[ANSWERS_KEY])
  const amendment: Amendment = {
    id: randomUUID(),
    title,
    text: typeof body.text === 'string' ? body.text.trim().slice(0, AMENDMENT_TEXT_MAX) : '',
    change,
    effective: body.effective === 'now' ? 'now' : 'next_season',
    threshold: answers.amendmentThreshold,
    pollMessageId: null,
    closesAt: new Date(now.getTime() + answers.voteDays * 86_400_000).toISOString(),
    status: 'voting',
    yes: null,
    no: null,
    proposedBy: userId,
    proposedAt: now.toISOString(),
    resolvedAt: null,
    appliedAt: null,
    applyError: null,
  }
  const question = amendmentPollQuestion(amendment)
  try {
    const { createLeagueChatMessage } = await import('@/lib/league-chat/LeagueChatMessageService')
    const msg = await createLeagueChatMessage(leagueId, userId, `${question}${amendment.text ? `\n${amendment.text}` : ''}`, {
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
  } catch (e) {
    console.warn('[constitution] amendment poll failed', e instanceof Error ? e.message : e)
    return { ok: false, error: 'poll_failed' }
  }
  await updateSettingsLocked(leagueId, (s) => ({ ...s, [AMENDMENTS_KEY]: pruneAmendments([amendment, ...readAmendments(s[AMENDMENTS_KEY])]) }))
  await audit(leagueId, userId, 'amendment_proposed', { id: amendment.id, title, change })
  return { ok: true, amendment }
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
  await audit(leagueId, actorUserId, ok ? 'amendment_applied' : 'amendment_apply_failed', { id: a.id, change: describeChange(a.change), reason })
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

export async function withdrawAmendment(leagueId: string, userId: string, amendmentId: string): Promise<boolean> {
  let changed = false
  await updateSettingsLocked(leagueId, (s) => {
    const list = readAmendments(s[AMENDMENTS_KEY])
    if (!list.some((a) => a.id === amendmentId && a.status === 'voting')) return null
    changed = true
    return { ...s, [AMENDMENTS_KEY]: list.map((a) => (a.id === amendmentId ? { ...a, status: 'withdrawn' as const, resolvedAt: new Date().toISOString() } : a)) }
  })
  if (changed) await audit(leagueId, userId, 'amendment_withdrawn', { id: amendmentId })
  return changed
}

// ── View ────────────────────────────────────────────────────────────────────

export type ConstitutionView = {
  current: ConstitutionVersion | null
  history: Array<Omit<ConstitutionVersion, 'sections'>>
  answers: ConstitutionAnswers
  amendments: Amendment[]
  entitled: boolean
  isCommissioner: boolean
}

export async function readConstitutionView(leagueId: string, viewer: { userId: string; isCommissioner: boolean }): Promise<ConstitutionView | null> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true, settings: true } })
  if (!league) return null
  const [versions, amendments, entitled] = await Promise.all([
    readVersions(leagueId),
    resolveAmendments(leagueId),
    viewer.isCommissioner ? constitutionEntitled(league.userId) : Promise.resolve(false),
  ])
  return {
    current: versions[0] ?? null,
    history: versions.map((v) => ({ id: v.id, version: v.version, publishedAt: v.publishedAt, publishedBy: v.publishedBy, source: v.source })),
    answers: parseAnswers(asRecord(league.settings)[ANSWERS_KEY]),
    amendments,
    entitled,
    isCommissioner: viewer.isCommissioner,
  }
}
