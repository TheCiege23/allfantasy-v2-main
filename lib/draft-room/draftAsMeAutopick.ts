import 'server-only'

import { prisma } from '@/lib/prisma'
import { EntitlementResolver } from '@/lib/subscription/EntitlementResolver'
import { buildDraftStyle, pickLikeManager, type DraftStyle } from './draftAsMe'
import { loadManagerPastPicks } from './managerHistoryReads'
import type { AutopickFallbackPoolEntry } from '@/lib/live-draft-engine/autopickBestAvailableSubmit'

/**
 * Draft as me (./draftAsMe.ts) for a missed pick, on the league owner's AF Commissioner plan. The
 * commissioner switches it off per league with `League.settings.draft_as_me = false`; otherwise it is
 * on for every entitled league. Returns null — and the ordinary autopick runs — whenever there is no
 * plan, no switch, no history or no board to judge.
 */
export const DRAFT_AS_ME_FEATURE = 'commissioner_draft_as_me' as const
export const DRAFT_AS_ME_SETTING = 'draft_as_me'

export type DraftAsMePick = AutopickFallbackPoolEntry & { reason: string }

export function describeDraftStyle(style: DraftStyle): string {
  const lean = Object.entries(style.positionShare).sort((a, b) => b[1] - a[1])[0]
  const timing =
    style.reachDelta <= -3
      ? `you usually take players about ${Math.round(-style.reachDelta)} picks before their ADP`
      : style.reachDelta >= 3
        ? `you usually wait about ${Math.round(style.reachDelta)} picks past ADP for value`
        : 'you usually draft close to ADP'
  return `Picked the way you draft: ${timing}${lean ? `, and ${Math.round(lean[1] * 100)}% of your picks are ${lean[0]}s` : ''}.`
}

export async function draftAsMeEnabledForLeague(leagueId: string): Promise<boolean> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true, settings: true } })
  if (!league?.userId) return false
  const settings = league.settings && typeof league.settings === 'object' ? (league.settings as Record<string, unknown>) : {}
  if (settings[DRAFT_AS_ME_SETTING] === false) return false
  try {
    return Boolean((await new EntitlementResolver().resolveForUser(league.userId, DRAFT_AS_ME_FEATURE)).hasAccess)
  } catch {
    return false
  }
}

export async function tryDraftAsMePick(args: {
  leagueId: string
  rosterId: string
  overall: number
  board: readonly AutopickFallbackPoolEntry[]
  ownPositions: readonly string[]
  eligible?: ReadonlySet<string> | null
  /** The draft's own ADP, keyed `name|position|team`, preferred over the pool's market ADP. */
  aiAdpByKey?: Record<string, number>
}): Promise<DraftAsMePick | null> {
  if (!(await draftAsMeEnabledForLeague(args.leagueId))) return null
  const style = buildDraftStyle(await loadManagerPastPicks(args.leagueId, args.rosterId))
  if (!style) return null
  const key = (e: AutopickFallbackPoolEntry) => `${e.playerName.trim().toLowerCase()}|${(e.position || '').toLowerCase()}|${(e.team || '').toLowerCase()}`
  const board = args.board.map((e) => ({ ...e, adp: args.aiAdpByKey?.[key(e)] ?? e.adp }))
  const chosen = pickLikeManager({ style, overall: args.overall, board, ownPositions: args.ownPositions, eligible: args.eligible })
  if (!chosen) return null
  const original = args.board.find((e) => key(e) === key(chosen.player))
  return original ? { ...original, reason: describeDraftStyle(style) } : null
}
