import type { UserLeague } from '@/app/dashboard/types'
import { isNativePlatform } from '@/lib/dashboard/platform-label'

/**
 * A league hosted here that has not drafted yet: its schedule is generated when the draft ends (owner,
 * 2026-11-28), so it has no matchups, no standings and no activity to show. Imported leagues keep what
 * their host has. A league with no lifecycle at all is NOT read as "before the draft".
 */
export function noScheduleYet(league: Pick<UserLeague, 'lifecycleState' | 'platform'>): boolean {
  if (!isNativePlatform(league.platform)) return false
  return ['setup', 'pre_draft', 'predraft', 'draft_setup', 'drafting', 'in_draft'].includes(String(league.lifecycleState ?? '').trim().toLowerCase())
}
