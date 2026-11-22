import { rosterManagerKey } from '@/lib/league/rosterManager'
import 'server-only'

import { prisma } from '@/lib/prisma'
import { EntitlementResolver } from '@/lib/subscription/EntitlementResolver'
import { buildDraftStyle, MIN_STYLE_SAMPLE, pickLikeManager, type DraftStyle } from './draftAsMe'
import { loadManagerPastPicks } from './managerHistoryReads'
import { loadDraftPlayerAges } from './draftPlayerAges'
import { isAutopilotRoster } from '@/lib/live-draft-engine/instantAutopick'
import { readPlayableChimmyLineups } from '@/lib/inactive-manager/chimmyPlayable'
import { getViewerAutopickPreference } from '@/lib/live-draft-engine/LiveDraftAutopickPreferenceService'
import type { AutopickFallbackPoolEntry } from '@/lib/live-draft-engine/autopickBestAvailableSubmit'

/**
 * Draft as me (./draftAsMe.ts) for a missed pick. Two ways it is on for a team:
 *   - league-wide, on the league owner's AF Commissioner plan. The commissioner switches it off per
 *     league with `League.settings.draft_as_me = false`; otherwise it is on for every entitled league;
 *   - for one manager's own team, on THEIR AF Pro plan (phase 6, 2026-10-27): the "Draft like me" mode
 *     of their auto-pick setting in the draft room (`LiveDraftAutopickPreference.mode = 'draft_as_me'`),
 *     whatever the league's plan or switch;
 *   - for a team Chimmy runs on autopilot (`draftAsMeEnabledForLeague` with its roster).
 * Returns null — and the ordinary autopick runs — whenever neither applies, or there is no history or
 * no board to judge.
 */
export const DRAFT_AS_ME_FEATURE = 'commissioner_draft_as_me' as const
export const DRAFT_AS_ME_SETTING = 'draft_as_me'

export type DraftAsMePick = AutopickFallbackPoolEntry & { reason: string }

/** Where a style was learned: the manager's own past picks and the drafts they came from. */
export type DraftStyleReference = { ownPicks: number; drafts: string[] }

/** Pure: "from 14 of your own picks in 2 drafts (latest: Alpha League)". */
export function describeStyleReference(ref: DraftStyleReference): string {
  const drafts = ref.drafts.length
  const latest = ref.drafts[0] ? ` (latest: ${ref.drafts[0]})` : ''
  return `Learned from ${ref.ownPicks} of your own pick${ref.ownPicks === 1 ? '' : 's'} in ${drafts} past draft${drafts === 1 ? '' : 's'}${latest}.`
}

/** Pure: the same, when there is not enough to learn from yet. */
export function describeNotEnoughHistory(ownPicks: number): string {
  return `Draft like me needs ${MIN_STYLE_SAMPLE} of your own picks from past drafts and has ${ownPicks}, so Chimmy took the best player for your roster instead. Auto-picks and commissioner picks do not count.`
}

/** Pure: the reference behind a manager's past picks, newest draft first. */
export function styleReferenceOf(picks: ReadonlyArray<{ leagueName?: string | null }>): DraftStyleReference {
  const drafts: string[] = []
  for (const p of picks) {
    const name = String(p.leagueName ?? '').trim() || 'Unnamed league'
    if (!drafts.includes(name)) drafts.push(name)
  }
  return { ownPicks: picks.length, drafts }
}

/** What the draft room says about this manager's "Draft like me" before any pick is made. */
export async function draftAsMeStatus(leagueId: string, rosterId: string): Promise<{ ready: boolean; ownPicks: number; needed: number; summary: string }> {
  const past = await loadManagerPastPicks(leagueId, rosterId)
  const style = buildDraftStyle(past)
  const ref = styleReferenceOf(past)
  if (!style) return { ready: false, ownPicks: ref.ownPicks, needed: MIN_STYLE_SAMPLE, summary: describeNotEnoughHistory(ref.ownPicks) }
  return { ready: true, ownPicks: ref.ownPicks, needed: MIN_STYLE_SAMPLE, summary: `${describeDraftStyle(style)} ${describeStyleReference(ref)}` }
}

export function describeDraftStyle(style: DraftStyle): string {
  const lean = Object.entries(style.positionShare).sort((a, b) => b[1] - a[1])[0]
  const timing =
    style.reachDelta <= -3
      ? `you usually take players about ${Math.round(-style.reachDelta)} picks before their ADP`
      : style.reachDelta >= 3
        ? `you usually wait about ${Math.round(style.reachDelta)} picks past ADP for value`
        : 'you usually draft close to ADP'
  const youth =
    style.youthLean != null && Math.abs(style.youthLean) >= 1
      ? `, and you draft about ${Math.round(Math.abs(style.youthLean))} year${Math.round(Math.abs(style.youthLean)) === 1 ? '' : 's'} ${style.youthLean > 0 ? 'younger' : 'older'} than the room`
      : ''
  return `Picked the way you draft: ${timing}${lean ? `, ${youth ? '' : 'and '}${Math.round(lean[1] * 100)}% of your picks are ${lean[0]}s` : ''}${youth}.`
}

/**
 * On for the league (the owner's AF Commissioner plan and the commissioner's switch), or — given a
 * roster — for a team Chimmy runs on autopilot (phase 7, 2026-10-29). Autopilot is already AF
 * Commissioner, and keeping the team its owner built is its whole job, so it drafts the way the owner
 * did whatever the league-wide switch says. With no draft history to read, the ordinary autopick runs.
 */
export async function draftAsMeEnabledForLeague(leagueId: string, rosterId?: string): Promise<boolean> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true, settings: true } })
  if (rosterId && league && isAutopilotRoster({ af_managed_lineups: await readPlayableChimmyLineups({ id: leagueId, userId: league.userId, settings: league.settings }) }, rosterId)) return true
  if (!league?.userId) return false
  const settings = league.settings && typeof league.settings === 'object' ? (league.settings as Record<string, unknown>) : {}
  if (settings[DRAFT_AS_ME_SETTING] === false) return false
  try {
    return Boolean((await new EntitlementResolver().resolveForUser(league.userId, DRAFT_AS_ME_FEATURE)).hasAccess)
  } catch {
    return false
  }
}

/**
 * The manager of this roster chose "Draft like me" for this draft and is on AF Pro. The read-time
 * downgrade in `getViewerAutopickPreference` already drops the mode when Pro lapses.
 */
export async function personalDraftAsMeOn(draftSessionId: string, rosterId: string): Promise<boolean> {
  const roster = await prisma.roster.findUnique({ where: { id: rosterId }, select: { platformUserId: true, managerUserId: true } })
  const userId = (roster ? rosterManagerKey(roster) : null) ?? ''
  if (!userId || userId.startsWith('orphan-') || userId.startsWith('ai-manager-')) return false
  const pref = await getViewerAutopickPreference(draftSessionId, userId)
  return pref.enabled && pref.mode === 'draft_as_me'
}

export async function tryDraftAsMePick(args: {
  leagueId: string
  /** The live draft, for the manager's own "Draft like me" setting. */
  draftSessionId?: string
  rosterId: string
  overall: number
  board: readonly AutopickFallbackPoolEntry[]
  ownPositions: readonly string[]
  eligible?: ReadonlySet<string> | null
  /** The draft's own ADP, keyed `name|position|team`, preferred over the pool's market ADP. */
  aiAdpByKey?: Record<string, number>
  /** The draft's sport, for player ages. */
  sport?: string | null
  /** Called with the explanation when draft as me is on but has too little history to judge. */
  onNotEnoughHistory?: (reason: string) => void
}): Promise<DraftAsMePick | null> {
  const on =
    (args.draftSessionId ? await personalDraftAsMeOn(args.draftSessionId, args.rosterId).catch(() => false) : false) ||
    (await draftAsMeEnabledForLeague(args.leagueId, args.rosterId))
  if (!on) return null
  const past = await loadManagerPastPicks(args.leagueId, args.rosterId)
  const style = buildDraftStyle(past)
  if (!style) {
    args.onNotEnoughHistory?.(describeNotEnoughHistory(past.length))
    return null
  }
  const key = (e: AutopickFallbackPoolEntry) => `${e.playerName.trim().toLowerCase()}|${(e.position || '').toLowerCase()}|${(e.team || '').toLowerCase()}`
  // Ages only matter when this manager has a youth lean; otherwise the board is not read for them.
  const ages = style.youthLean != null ? await loadDraftPlayerAges(args.sport, args.board.map((e) => e.playerId)).catch(() => new Map<string, number>()) : new Map<string, number>()
  const board = args.board.map((e) => ({ ...e, adp: args.aiAdpByKey?.[key(e)] ?? e.adp, age: e.playerId ? ages.get(e.playerId) ?? null : null }))
  const chosen = pickLikeManager({ style, overall: args.overall, board, ownPositions: args.ownPositions, eligible: args.eligible })
  if (!chosen) return null
  const original = args.board.find((e) => key(e) === key(chosen.player))
  return original ? { ...original, reason: `${describeDraftStyle(style)} ${describeStyleReference(styleReferenceOf(past))}` } : null
}
