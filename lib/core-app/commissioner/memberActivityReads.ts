import 'server-only'

import { getLeagueManagerHealth } from '@/lib/commissioner-hub/managerHealth'
import { readActivityWindow, readManagerActivity } from '@/lib/league-history/leagueWarehouseReads'
import { MANAGER_INACTIVE_AFTER_DAYS } from '@/lib/decision-os/behavioral/manager-intelligence'
import type { MemberActivityReads } from './activity'

/**
 * The reads behind `memberActivityFromReads`, for the Commissioner Hub and the league Overview's
 * commissioner card alike.
 *
 * A league AllFantasy runs is judged by its roster clock, which its managers' own actions write. An
 * imported league is judged by moves, because the sync rewrites every roster row on each pass —
 * see ./activity.ts. Each read degrades to null rather than throwing, so one failed read costs the
 * activity answer, not the page.
 */
export async function readMemberActivityInputs(leagueId: string, native: boolean): Promise<MemberActivityReads> {
  if (native) {
    const health = await getLeagueManagerHealth(leagueId).catch(() => null)
    return { native: true, rows: health?.rows ?? null }
  }
  const [managers, window] = await Promise.all([
    readManagerActivity(leagueId, MANAGER_INACTIVE_AFTER_DAYS).catch(() => null),
    readActivityWindow(leagueId).catch(() => null),
  ])
  return { native: false, managers, window }
}
