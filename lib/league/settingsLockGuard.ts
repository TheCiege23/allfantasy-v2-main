import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { groupForSettingsKey, lockedMessage, type LockGroup } from './settingsLock'
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

/**
 * The lock check for a route whose body names several settings at once (dynasty settings, a format's setup): each
 * key is mapped to its area with `groupForSettingsKey`, and any locked area refuses the whole request. Keys no lock
 * covers (draft setup, names) never refuse. Fails open, like the checks above.
 */
export async function settingsKeysLockedResponse(leagueId: string, keys: readonly string[]): Promise<NextResponse | null> {
  const groups = [...new Set(keys.map(groupForSettingsKey).filter((g): g is LockGroup => g != null))]
  if (groups.length === 0) return null
  try {
    const locked = await lockedGroups(leagueId, groups)
    if (!locked.length) return null
    return NextResponse.json({ error: lockedMessage(locked), code: 'settings_locked', lockedGroups: locked }, { status: 423 })
  } catch (e) {
    console.warn('[settings-lock] key check failed, allowing the write', e instanceof Error ? e.message : e)
    return null
  }
}
