import type { RosterRuntimeSections } from '@/lib/roster-runtime/canonicalRosterRuntime'
import type { SimLeagueFormat } from './rules'

/**
 * Who manages a simulated team.
 * - active   — sets the best lineup it can see, claims useful free agents, makes fair trades.
 * - ghost    — drafts, then never logs in again: injured and bye-week starters stay in the lineup.
 * - tanker   — fields its weakest lineup on purpose, inactive starters first.
 * - chaos    — random lineups, full-balance and over-balance FAAB bids, claims for rostered players,
 *              drops it does not own, trades after the deadline.
 * - colluder — plays like `active`, but dumps its best players on its partner for scraps.
 */
export type BotPersona = 'active' | 'ghost' | 'tanker' | 'chaos' | 'colluder'

export const BOT_PERSONAS: readonly BotPersona[] = ['active', 'ghost', 'tanker', 'chaos', 'colluder']

export type SimTeam = {
  rosterId: string
  displayName: string
  ownerId: string
  persona: BotPersona
  /** Colluders come in pairs; each names the other. */
  partnerRosterId: string | null
  draftSlot: number
  faabBalance: number
  waiverPriority: number
  sections: RosterRuntimeSections
  eliminatedWeek: number | null
}

export type SimPhase = 'draft' | 'lineups' | 'scoring' | 'standings' | 'waivers' | 'trades' | 'guillotine' | 'playoffs' | 'season'

export type SimViolation = {
  /** Stable invariant id, e.g. `PLAYER_ON_TWO_ROSTERS`. */
  code: string
  week: number | null
  phase: SimPhase
  message: string
  rosterId?: string
  detail?: Record<string, unknown>
}

export type SimSignals = {
  waiverClaimsSubmitted: number
  waiverClaimsRejectedAtSubmit: number
  waiverClaimsWon: number
  waiverClaimsLost: number
  tradesProposed: number
  tradesRejectedAtValidation: number
  tradesExecuted: number
  inactiveStarterWeeks: number
  byeStarterWeeks: number
  guillotineChops: number
  /** Matchups the canonical scoring runtime still called not-`complete` when the week closed. */
  matchupsNotFinalAtWeekEnd: number
  rejectionCodes: Record<string, number>
}

export type SimSeasonOptions = {
  seed: number | string
  format?: SimLeagueFormat
  teamCount?: number
  regularSeasonWeeks?: number
  playoffTeams?: number
  tradeDeadlineWeek?: number
  benchSize?: number
  faabBudget?: number
  season?: number
  /** Persona per draft slot; cycles when shorter than the team count. */
  personas?: BotPersona[]
  /** Stop after this many violations, so one broken invariant does not produce thousands of rows. */
  maxViolations?: number
}

export type SimSeasonReport = {
  seed: number
  seedInput: number | string
  format: SimLeagueFormat
  leagueId: string
  season: number
  teamCount: number
  weeksSimulated: number
  personas: Record<string, BotPersona>
  championRosterId: string | null
  violations: SimViolation[]
  signals: SimSignals
  /** Copy-paste command that replays exactly this season. */
  reproduce: string
  /** Engine exceptions are recorded as a violation and end the run; this is the message. */
  aborted: string | null
}
