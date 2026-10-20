import 'server-only'

import { prisma } from '@/lib/prisma'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'
import { getDraftLotteryLastResultFromSettings } from '@/lib/draft-lottery/lotteryConfigStorage'
import { ABSENT_MANAGER_RULE_KEY, normalizeAbsentManagerRule, readAbsentManagerRule, type AbsentManagerRule } from './absentManager'
import { buildShow, DRAFT_SHOW_KEY, isShowCurrent, PACE_MS, progress, readShow, type DraftShow, type ShowKind, type ShowPace, type SlotRow } from './draftShow'

/**
 * Draft-day kit — reads and writes. Pure rules in ./draftShow and ./absentManager.
 *
 * Both settings live in `League.settings` (no migration): the show under `draft_day_show`, the
 * absent-manager rule under `draft_absent_manager_rule`, where the pick engine reads it. Writes take
 * the league row lock so a show start and a settings save cannot overwrite each other's keys.
 */

/** Statuses before the first pick, when the order can still be revealed. */
const PRE_DRAFT = new Set(['pre_draft', 'configuring', 'configured'])

export type DraftDayView = {
  sessionId: string | null
  status: string | null
  /** The show to play, or null. Only a show for this draft, revealing the order it will use. */
  show: DraftShow | null
  /** Server time, so every viewer reads the show's timeline from the same clock. */
  serverNow: string
  canStartShow: { order: boolean; lottery: boolean }
  absentRule: AbsentManagerRule
}

async function currentSession(leagueId: string) {
  return prisma.draftSession.findFirst({
    where: { leagueId },
    orderBy: CURRENT_DRAFT_SESSION_ORDER,
    select: { id: true, status: true, slotOrder: true, teamCount: true, sessionKind: true, sleeperDraftId: true },
  })
}

const slotRows = (raw: unknown): SlotRow[] =>
  Array.isArray(raw)
    ? raw.flatMap((r) => {
        const o = r as Record<string, unknown>
        return typeof o?.slot === 'number' && typeof o?.rosterId === 'string' && o.rosterId
          ? [{ slot: o.slot, rosterId: o.rosterId, displayName: typeof o.displayName === 'string' ? o.displayName : null }]
          : []
      })
    : []

export async function readDraftDay(leagueId: string, now = new Date()): Promise<DraftDayView | null> {
  const [league, session] = await Promise.all([
    prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } }),
    currentSession(leagueId),
  ])
  if (!league) return null
  const order = session ? slotRows(session.slotOrder) : []
  const stored = readShow(league.settings)
  const show = stored && session && isShowCurrent(stored, { id: session.id, slotOrder: order }) && !progress(stored, now.getTime()).over ? stored : null
  const live = Boolean(session && session.sessionKind === 'live' && !session.sleeperDraftId && PRE_DRAFT.has(session.status))
  const probe = (kind: ShowKind) =>
    live && session
      ? buildShow({ sessionId: session.id, kind, pace: 'standard', order, teamCount: session.teamCount, lottery: getDraftLotteryLastResultFromSettings((league.settings ?? {}) as Record<string, unknown>), startedBy: '', now }).ok
      : false
  return {
    sessionId: session?.id ?? null,
    status: session?.status ?? null,
    show,
    serverNow: now.toISOString(),
    canStartShow: { order: probe('order'), lottery: probe('lottery') },
    absentRule: readAbsentManagerRule(league.settings),
  }
}

async function writeSettingsKey(leagueId: string, key: string, value: unknown): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM leagues WHERE id = ${leagueId} FOR UPDATE`
    const row = await tx.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
    if (!row) return false
    const next = { ...((row.settings as Record<string, unknown> | null) ?? {}) }
    if (value === null) delete next[key]
    else next[key] = value
    await tx.league.update({ where: { id: leagueId }, data: { settings: next as object } })
    return true
  })
}

export type StartShowError = 'not_found' | 'draft_started' | 'order_incomplete' | 'no_lottery' | 'lottery_stale' | 'bad_pace' | 'bad_kind'

export async function startShow(
  leagueId: string,
  userId: string,
  input: { kind: unknown; pace: unknown },
  now = new Date(),
): Promise<{ ok: true; show: DraftShow } | { ok: false; error: StartShowError }> {
  if (input.kind !== 'order' && input.kind !== 'lottery') return { ok: false, error: 'bad_kind' }
  const pace = (input.pace ?? 'standard') as ShowPace
  if (!(pace in PACE_MS)) return { ok: false, error: 'bad_pace' }
  const [league, session] = await Promise.all([
    prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } }),
    currentSession(leagueId),
  ])
  if (!league || !session) return { ok: false, error: 'not_found' }
  if (session.sessionKind !== 'live' || session.sleeperDraftId || !PRE_DRAFT.has(session.status)) return { ok: false, error: 'draft_started' }
  const built = buildShow({
    sessionId: session.id,
    kind: input.kind,
    pace,
    order: slotRows(session.slotOrder),
    teamCount: session.teamCount,
    lottery: getDraftLotteryLastResultFromSettings((league.settings ?? {}) as Record<string, unknown>),
    startedBy: userId,
    now,
  })
  if (!built.ok) return { ok: false, error: built.reason }
  if (!(await writeSettingsKey(leagueId, DRAFT_SHOW_KEY, built.show))) return { ok: false, error: 'not_found' }
  return { ok: true, show: built.show }
}

export async function stopShow(leagueId: string): Promise<boolean> {
  return writeSettingsKey(leagueId, DRAFT_SHOW_KEY, null)
}

export async function saveAbsentRule(leagueId: string, raw: unknown): Promise<AbsentManagerRule | null> {
  const rule = normalizeAbsentManagerRule(raw)
  return (await writeSettingsKey(leagueId, ABSENT_MANAGER_RULE_KEY, rule)) ? rule : null
}
