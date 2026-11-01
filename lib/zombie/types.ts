/**
 * Shared types for Zombie league backend engine (PROMPT 353).
 * NFL-first; sport-extensible.
 */

export type ZombieOwnerStatus = 'Survivor' | 'Zombie' | 'Whisperer'

export type WhispererSelection = 'random' | 'veteran_priority'

/** Config loaded from DB (ZombieLeagueConfig + League.sport). */
export interface ZombieLeagueConfigLoaded {
  leagueId: string
  configId: string
  universeId: string | null
  whispererSelection: WhispererSelection
  infectionLossToWhisperer: boolean
  infectionLossToZombie: boolean
  serumReviveCount: number
  autoSerumRevive: boolean
  serumAwardHighScore: boolean
  serumAwardOnBashMaul: boolean
  serumUseBeforeLastStarter: boolean
  weaponScoreThresholds: WeaponThreshold[] | null
  weaponTopTwoActive: boolean
  bombOneTimeOverride: boolean
  ambushCountPerWeek: number
  ambushRemapMatchup: boolean
  noWaiverFreeAgency: boolean
  statCorrectionReversal: boolean
  zombieTradeBlocked: boolean
  dangerousDropThreshold: number | null
}

export interface WeaponThreshold {
  minPoints: number
  weaponType: string
}

/** Per-roster status row. */
export interface ZombieLeagueTeamRow {
  id: string
  leagueId: string
  zombieLeagueId: string | null
  rosterId: string
  status: ZombieOwnerStatus
  weekBecameZombie: number | null
  killedByRosterId: string | null
  revivedAt: Date | null
}

/** Matchup result (team space: LeagueTeam.id). */
export interface ZombieMatchupResult {
  teamA: string
  teamB: string
  scoreA: number
  scoreB: number
  winnerTeamId: string | null
  matchupId?: string
}

/** Roster <-> Team mapping for a league (by draft order or index). */
export interface RosterTeamMap {
  rosterIdToTeamId: Map<string, string>
  teamIdToRosterId: Map<string, string>
}

/** Infection outcome for one week. */
export interface ZombieInfectionOutcome {
  leagueId: string
  week: number
  infected: { survivorRosterId: string; infectedByRosterId: string; matchupId?: string }[]
}

/** Universe level row. */
export interface ZombieUniverseLevelRow {
  id: string
  universeId: string
  name: string
  rankOrder: number
  leagueCount: number
}

/** Universe league row (league in universe). */
export interface ZombieUniverseLeagueRow {
  id: string
  universeId: string
  levelId: string
  leagueId: string
  name: string | null
  orderInLevel: number
}

/** Audit event types (deterministic). */
export type ZombieAuditEventType =
  | 'whisperer_selected'
  | 'infection'
  | 'revive'
  | 'serum_award'
  | 'serum_use'
  | 'weapon_award'
  | 'weapon_use'
  | 'weapon_transfer'
  | 'ambush_use'
  | 'weekly_winnings'
  | 'movement_projection'
  | 'stat_correction_reversal'
  | 'dangerous_drop_flag'
  | 'collusion_flag'
  | 'owner_replacement'
  | 'commissioner_override'
