import { isSeatPlaceholderUserId } from '@/lib/orphan-ai-manager/orphan-platform-ids'
import { rosterManagerKey } from '@/lib/league/rosterManager'
import 'server-only'

import { prisma } from '@/lib/prisma'
import { isChimmyRunning, readManagedLineups, type ManagedLineups } from '@/lib/inactive-manager/inactiveManagerMode'
import { readPlayableChimmyLineups } from '@/lib/inactive-manager/chimmyPlayable'

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
  return isAutopilotIn(readManagedLineups(leagueSettings), rosterId, currentOwnerId)
}

function isAutopilotIn(managed: ManagedLineups, rosterId: string, currentOwnerId?: string | null): boolean {
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
  const roster = await prisma.roster.findUnique({ where: { id: args.rosterId }, select: { platformUserId: true, managerUserId: true } })
  // Only a team Chimmy PLAYS picks instantly: without the owner's plan, that is the free team alone.
  const playable = await readPlayableChimmyLineups({ id: args.leagueId, settings })
  if (isAutopilotIn(playable, args.rosterId, roster?.platformUserId ?? null)) return 'autopilot'

  const userId = (roster ? rosterManagerKey(roster) : null) ?? ''
  if (!userId || isSeatPlaceholderUserId(userId)) return null
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

/**
 * Every team in this draft that picks by itself right now — the teams the board marks "AUTO".
 *
 * Same two rules as `instantAutopickReason`, read in bulk: a Chimmy-run (autopilot) team, or a
 * manager whose "Auto-pick me" is on. Before this, nothing on the board said a seat was on
 * auto-pick, so a manager who switched it on saw no sign that it had taken.
 */
export async function listAutoDraftRosterIds(args: {
  leagueId: string
  draftSessionId: string
  leagueSettings?: unknown
}): Promise<string[]> {
  const [settings, rosters, prefs] = await Promise.all([
    args.leagueSettings !== undefined
      ? Promise.resolve(args.leagueSettings)
      : prisma.league.findUnique({ where: { id: args.leagueId }, select: { settings: true } }).then((l) => l?.settings),
    prisma.roster.findMany({
      where: { leagueId: args.leagueId },
      select: { id: true, platformUserId: true, managerUserId: true },
    }),
    prisma.liveDraftAutopickPreference.findMany({
      where: { draftSessionId: args.draftSessionId, enabled: true },
      select: { userId: true },
    }),
  ])
  const playable = await readPlayableChimmyLineups({ id: args.leagueId, settings })
  const autoUsers = new Set(prefs.map((p) => p.userId))
  const out: string[] = []
  for (const roster of rosters) {
    if (isAutopilotIn(playable, roster.id, roster.platformUserId ?? null)) {
      out.push(roster.id)
      continue
    }
    const userId = rosterManagerKey(roster) ?? ''
    if (!userId || isSeatPlaceholderUserId(userId)) continue
    if (autoUsers.has(userId)) out.push(roster.id)
  }
  return out
}
