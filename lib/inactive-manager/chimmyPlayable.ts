import 'server-only'

import { prisma } from '@/lib/prisma'
import { EntitlementResolver } from '@/lib/subscription/EntitlementResolver'
import {
  autopilotRosterIds,
  CHIMMY_FREE_TEAMS,
  playableManagedLineups,
  readManagedLineups,
  type ManagedLineups,
} from './inactiveManagerMode'

/** The plan that lets Chimmy run more than its free team(s): the league owner's AF Commissioner. */
const AUTOPILOT_FEATURE = 'commissioner_chimmy_autopilot'

/**
 * How long a league owner's plan answer is reused. The draft asks on every pick and Survivor on every
 * tick, so without this each would call the entitlement resolver; a plan change takes effect within
 * a minute either way.
 */
export const CHIMMY_PLAN_CACHE_MS = 60_000
const planCache = new Map<string, { entitled: boolean; at: number }>()

/** Tests only. */
export function resetChimmyPlanCache(): void {
  planCache.clear()
}

async function ownerEntitled(ownerUserId: string | null | undefined, now: number): Promise<boolean> {
  if (!ownerUserId) return false
  const hit = planCache.get(ownerUserId)
  if (hit && now - hit.at < CHIMMY_PLAN_CACHE_MS) return hit.entitled
  let entitled = false
  try {
    entitled = Boolean((await new EntitlementResolver().resolveForUser(ownerUserId, AUTOPILOT_FEATURE)).hasAccess)
  } catch {
    entitled = false
  }
  planCache.set(ownerUserId, { entitled, at: now })
  return entitled
}

/**
 * The teams Chimmy PLAYS in this league (`playableManagedLineups`): every team it runs with the league
 * owner's AF Commissioner plan, only the free one without it. Every place Chimmy acts for a team — a
 * draft pick, an auction nomination, a Tribal vote or idol, an Exile pick — reads through here, so a
 * league that drops the plan keeps exactly one Chimmy team playing, the one it handed Chimmy first.
 *
 * A league running no more than the free allowance never asks about the plan at all.
 */
export async function readPlayableChimmyLineups(
  league: { id?: string; userId?: string | null; settings: unknown },
  now = Date.now(),
): Promise<ManagedLineups> {
  const managed = readManagedLineups(league.settings)
  if (autopilotRosterIds(managed).length <= CHIMMY_FREE_TEAMS) return managed
  let ownerUserId = league.userId
  if (ownerUserId === undefined && league.id) {
    ownerUserId = (await prisma.league.findUnique({ where: { id: league.id }, select: { userId: true } }))?.userId ?? null
  }
  return playableManagedLineups(managed, await ownerEntitled(ownerUserId, now))
}
