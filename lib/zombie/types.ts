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
