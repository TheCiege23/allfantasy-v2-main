import type { League, LeagueLifecycleState, LeagueSport } from '@prisma/client'
import type { RosterTemplateDto } from '@/lib/multi-sport/RosterTemplateService'
import type { ExpandedStarterSlot } from '@/lib/league/lineup-expand-template'

export type RosterSectionKey = 'starters' | 'bench' | 'ir' | 'taxi' | 'devy'

export const ROSTER_SECTION_KEYS: RosterSectionKey[] = [
  'starters',
  'bench',
  'ir',
  'taxi',
  'devy',
]

export type LineupValidationContext = {
  league: {
    id: string
    sport: LeagueSport
    leagueVariant: string | null
    settings: League['settings']
    lifecycleState: LeagueLifecycleState
    lockAllMoves: boolean | null
    irAllowOut: boolean | null
    irAllowCovid: boolean | null
    irAllowSuspended: boolean | null
    irAllowNA: boolean | null
    irAllowDNR: boolean | null
    irAllowDoubtful: boolean | null
    taxiSlots: number | null
    taxiAllowNonRookies: boolean | null
    taxiYearsLimit: number | null
    guillotineMode: boolean | null
    bestBallMode: boolean | null
  }
  template: RosterTemplateDto
  season: number
  week: number
  /**
   * The expanded starter slots a starter's `slotIndex` indexes (`resolveLineupStarterSlots`). When
   * given, every positioned starter is checked against HIS slot. Absent: no per-slot check.
   */
  starterSlots?: ExpandedStarterSlot[]
  /** The stored lineup this save replaces: an unchanged, carried-over slot position is not re-judged. */
  previousPlayerData?: unknown
}

export type RosterValidationIssue = {
  code: string
  message: string
  section?: RosterSectionKey
  playerId?: string
}

export type RosterValidationResult = {
  ok: boolean
  issues: RosterValidationIssue[]
}

export type LineupLockContext = {
  locked: boolean
  reason?: string
  policy: string
  globalLocked: boolean
  lockedPlayerIds: string[]
  perPlayerReasons: Record<string, string>
  leagueBlocksMoves: boolean
  specialtyBlocksMoves: boolean
}
