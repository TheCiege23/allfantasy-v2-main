/**
 * "How much should AllFantasy run?" — the dynasty creation wizard's one automation choice (phase 10,
 * 2026-10-29). Applied right after the league is created through the same presets the Commissioner Hub
 * offers (lib/commissioner-hub/automationPreset.ts), so the two never disagree about what a choice means.
 * Paid automations in a choice simply stay off when the commissioner has no AF Commissioner plan.
 */
import type { LeagueTypeId } from './types'

export type SelfRunningPreset = 'hands_on' | 'recommended' | 'run_it'
export const DEFAULT_SELF_RUNNING_PRESET: SelfRunningPreset = 'recommended'

/** Dynasty-family leagues: the ones the self-running automations are built for. */
export function offersSelfRunningPreset(leagueType: LeagueTypeId | null | undefined): boolean {
  return leagueType === 'dynasty' || leagueType === 'devy' || leagueType === 'c2c'
}

export const SELF_RUNNING_OPTIONS: Array<{ id: SelfRunningPreset; label: string; description: string }> = [
  {
    id: 'hands_on',
    label: 'Hands-on',
    description: 'You run it. AllFantasy does not fill empty lineup spots or take over quiet teams; every automation stays off until you switch it on.',
  },
  {
    id: 'recommended',
    label: 'Recommended',
    description: 'AllFantasy keeps the league fair and moving: it fills empty starting spots, opens and starts the rookie draft on time, and (with AF Commissioner) watches for tanking and covers missed picks.',
  },
  {
    id: 'run_it',
    label: 'Run it for me',
    description: 'Everything in Recommended, plus a team with no activity for 14 days is handed to AllFantasy (Chimmy autopilot with AF Commissioner) until its owner comes back.',
  },
]
