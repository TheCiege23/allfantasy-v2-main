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
export type InstantAutopickReason = 'autopilot' | 'autopick_me' | 'computer_timed_out'

/**
 * 🛑 A MISSED CLOCK NOW PUTS THE TEAM ON AUTO FOR THE REST OF THE DRAFT (2026-11-24, owner's rule for
 * every sport and draft type). Before, a team the system picked for on an expired clock got the FULL
 * clock again on its next turn, so one absent seat stalled the room every round.
 *
 *   - A team with a manager: `markTeamAutoAfterTimeout` switches their "Auto-pick me" on — the
 *     board shows AUTO and the manager turns it off with the same switch, as on Sleeper.
 *   - A team with nobody to switch it off (an open seat, an imported orphan, an AI-manager seat):
 *     derived instead — any `source: 'auto'` pick of theirs in this draft keeps them on auto.
 */
function hasNoManager(userId: string): boolean {
  return !userId || isSeatPlaceholderUserId(userId)
}

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
  if (hasNoManager(userId)) {
    const autoPick = await prisma.draftPick.findFirst({
      where: { sessionId: args.draftSessionId, rosterId: args.rosterId, source: 'auto' },
      select: { id: true },
    })
    return autoPick ? 'computer_timed_out' : null
  }
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
  /**
   * The draft's execution mode. In an auto draft every team picks by itself, so every team is AUTO;
   * before 2026-11-25 an open seat earned the badge only after its first automatic pick, so most of
   * a 54-team board's columns read as if someone were picking by hand.
   */
  executionMode?: string | null
}): Promise<string[]> {
  if (args.executionMode === 'auto') {
    const all = await prisma.roster.findMany({ where: { leagueId: args.leagueId }, select: { id: true } })
    return all.map((roster) => roster.id)
  }
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
  const autoPickedRosters = new Set(
    (
      await prisma.draftPick.findMany({
        where: { sessionId: args.draftSessionId, source: 'auto' },
        select: { rosterId: true },
        distinct: ['rosterId'],
      })
    ).map((p) => p.rosterId),
  )
  const playable = await readPlayableChimmyLineups({ id: args.leagueId, settings })
  const autoUsers = new Set(prefs.map((p) => p.userId))
  const out: string[] = []
  for (const roster of rosters) {
    if (isAutopilotIn(playable, roster.id, roster.platformUserId ?? null)) {
      out.push(roster.id)
      continue
    }
    const userId = rosterManagerKey(roster) ?? ''
    if (hasNoManager(userId)) {
      if (autoPickedRosters.has(roster.id)) out.push(roster.id)
      continue
    }
    if (autoUsers.has(userId)) out.push(roster.id)
  }
  return out
}

/**
 * After the system picks for a team whose clock ran out: a manager's "Auto-pick me" goes on, so their
 * next picks are made as soon as they are on the clock. Their chosen mode is kept when they already
 * had a row. A seat with no manager needs nothing stored (see `hasNoManager` above).
 */
export async function markTeamAutoAfterTimeout(args: { draftSessionId: string; rosterId: string }): Promise<boolean> {
  const roster = await prisma.roster.findUnique({ where: { id: args.rosterId }, select: { platformUserId: true, managerUserId: true } })
  const userId = (roster ? rosterManagerKey(roster) : null) ?? ''
  if (hasNoManager(userId)) return false
  await prisma.liveDraftAutopickPreference.upsert({
    where: { draft_session_user_unique: { draftSessionId: args.draftSessionId, userId } },
    create: { draftSessionId: args.draftSessionId, userId, enabled: true, mode: 'standard' },
    update: { enabled: true },
  })
  return true
}
