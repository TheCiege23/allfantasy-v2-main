import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { lockedMessage, type LockGroup } from './settingsLock'
import { lockedGroups, lockedGroupsForPatch } from './settingsLockService'

/**
 * The settings-lock check for a route that writes one area of the rules (scoring, rosters,
 * playoffs, …): a 423 to return as-is, or null to go ahead. Call it after the route's own
 * permission check and before anything is written.
 *
 * ⚠ IT FAILS OPEN. An unreadable lock must not brick every settings screen in the league; the cost
 * of that is a write slipping through during a database error, which every other write would hit too.
 */
export async function settingsLockedResponse(leagueId: string, group: LockGroup): Promise<NextResponse | null> {
  try {
    const locked = await lockedGroups(leagueId, [group])
    if (!locked.length) return null
    return NextResponse.json({ error: lockedMessage(locked), code: 'settings_locked', lockedGroups: locked }, { status: 423 })
  } catch (e) {
    console.warn('[settings-lock] check failed, allowing the write', e instanceof Error ? e.message : e)
    return null
  }
}

/**
 * The same check for a route that patches several settings at once: only the values the body would
 * actually CHANGE count, so re-saving a section unchanged is never refused.
 */
export async function settingsPatchLockedResponse(leagueId: string, body: Record<string, unknown>): Promise<NextResponse | null> {
  try {
    const league = await prisma.league.findUnique({ where: { id: leagueId }, include: { leagueSettings: true } })
    if (!league) return null
    const locked = await lockedGroupsForPatch(leagueId, league as unknown as Record<string, unknown>, body)
    if (!locked.length) return null
    return NextResponse.json({ error: lockedMessage(locked), code: 'settings_locked', lockedGroups: locked }, { status: 423 })
  } catch (e) {
    console.warn('[settings-lock] patch check failed, allowing the write', e instanceof Error ? e.message : e)
    return null
  }
}
