import 'server-only'

import { prisma } from '@/lib/prisma'
import { isChimmyRunning, readManagedLineups } from '@/lib/inactive-manager/inactiveManagerMode'

/**
 * Teams whose live-draft picks are made AS SOON AS they are on the clock, not when the clock runs out
 * (phase 7, 2026-10-29):
 *
 *   - `autopilot`: a team Chimmy runs for an absent manager (`League.settings.af_managed_lineups`
 *     with an `autopilot` entry). Nobody is coming to pick, so waiting out the timer only stalls the
 *     room — and in an untimed draft it stalled it forever.
 *   - `autopick_me`: a manager who turned on "Auto-pick me" in the draft room
 *     (`LiveDraftAutopickPreference.enabled`). Every mode used to wait for the clock to expire, which
 *     made the switch look broken.
 *
 * The pick itself is the ordinary timeout pick (queue, then draft as me, then the league's autopick),
 * through the same paths and locks, so nothing about WHAT is picked changes — only WHEN. A league's
 * "skip on timeout" rule does not apply: these teams asked for a pick.
 */
export type InstantAutopickReason = 'autopilot' | 'autopick_me'

/**
 * Pure: is this roster Chimmy-run in these league settings? With `currentOwnerId`, a team that has
 * changed hands since Chimmy was switched on is NOT: its new manager picks for themselves, even in
 * the minutes before the hourly sweep clears the entry.
 */
export function isAutopilotRoster(leagueSettings: unknown, rosterId: string, currentOwnerId?: string | null): boolean {
  const managed = readManagedLineups(leagueSettings)
  return currentOwnerId === undefined ? Boolean(managed[rosterId]?.autopilot) : isChimmyRunning(managed, rosterId, currentOwnerId)
}

export async function instantAutopickReason(args: {
  leagueId: string
  draftSessionId: string
  rosterId: string
  /** The league's settings when the caller already read them. */
  leagueSettings?: unknown
}): Promise<InstantAutopickReason | null> {
  const settings =
    args.leagueSettings !== undefined
      ? args.leagueSettings
      : (await prisma.league.findUnique({ where: { id: args.leagueId }, select: { settings: true } }))?.settings
  const roster = await prisma.roster.findUnique({ where: { id: args.rosterId }, select: { platformUserId: true } })
  if (isAutopilotRoster(settings, args.rosterId, roster?.platformUserId ?? null)) return 'autopilot'

  const userId = String(roster?.platformUserId ?? '')
  if (!userId || userId.startsWith('orphan-') || userId.startsWith('ai-manager-')) return null
  const pref = await prisma.liveDraftAutopickPreference.findUnique({
    where: { draft_session_user_unique: { draftSessionId: args.draftSessionId, userId } },
    select: { enabled: true },
  })
  return pref?.enabled ? 'autopick_me' : null
}

/**
 * Pure: should the timeout pick run now? An expired clock always; otherwise only for a team that
 * picks without waiting, and never while the draft is paused (by the commissioner or overnight).
 */
export function shouldPickNow(timerStatus: string, instant: InstantAutopickReason | null): boolean {
  if (timerStatus === 'expired') return true
  return instant != null && (timerStatus === 'running' || timerStatus === 'none')
}
