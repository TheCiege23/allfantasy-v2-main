/**
 * Frontend types for Zombie league (PROMPT 354).
 */
import type { ZombieBoardEntry, ZombieTurnMoment } from '@/lib/zombie/zombieHomeSummary'
import type { ZombieMatchupView } from '@/lib/zombie/zombieMatchupBoard'

export type { ZombieBoardEntry, ZombieTurnMoment, ZombieMatchupView }

export type ZombieView =
  | 'home'
  | 'resources'
  | 'ambush'
  | 'weekly-board'
  | 'ai'

export interface ZombieSummaryConfig {
  whispererSelection: string
  infectionLossToWhisperer: boolean
  infectionLossToZombie: boolean
  serumReviveCount: number
  zombieTradeBlocked: boolean
}

export interface ZombieSummary {
  config: ZombieSummaryConfig
  statuses: { rosterId: string; status: string }[]
  whispererRosterId: string | null
  /** True when a Whisperer exists but this viewer may not know who. */
  whispererHidden?: boolean
  survivors: string[]
  zombies: string[]
  week: number
  movementWatch: { rosterId: string; leagueId: string; reason: string; projectedLevelId: string | null }[]
  rosterDisplayNames?: Record<string, string>
  myRosterId?: string
  myResources?: { serums: number; weapons: number; ambush: number }
  league?: {
    name: string | null
    sport: string
    season: number
    /** 0 before activation. */
    currentWeek: number
    totalWeeks: number
    status: string | null
    backgroundTheme: string
    teamCount: number
    /** Null when the league is not part of a universe. */
    universeId?: string | null
  }
  /** Already redacted: a hidden Whisperer is a Survivor here, as everywhere else in this payload. */
  myStatus?: string | null
  /** Survivors who came back from a Zombie with serums. */
  revivedRosterIds?: string[]
  /** The selected week's events, in roster ids. A null infector is one this viewer may not know. */
  weeklyBoard?: ZombieBoardEntry[]
  myMatchup?: {
    opponentRosterId: string
    opponentName: string
    opponentStatus: string
    myScore: number
    opponentScore: number
    final: boolean
  } | null
  /** Outbreak Points: `week` is null until that week is settled. */
  myWinnings?: { week: number | null; total: number } | null
  /** My matchup as the Bashing card draws it. */
  myMatchupView?: ZombieMatchupView | null
  /** The latest week whose resolution completed; null before the first. */
  lastResolvedWeek?: number | null
  /** The status change the ZombieTurn overlay announces once. */
  turnMoment?: ZombieTurnMoment | null
  /** Roster ids of the teams the viewer turned. */
  myInfections?: string[]
  /** False in a secret-Whisperer league. */
  whispererPublic?: boolean
  /** The engine's own numbers for this sport — never sample values. */
  rules?: {
    bashingMargin: number
    maulingMargin: number
    knifeScore: number
    bowScore: number
    axeMargin: number
    /** Serums a Zombie needs to revive (`serumEngine`'s check). */
    reviveSerums: number
    bashShare: number
    maulShare: number
  }
}

export interface ZombieUniverseStandingsRow {
  leagueId: string
  rosterId: string
  levelId: string
  levelName: string
  status: string
  displayName?: string
  leagueName?: string
  totalPoints: number
  pointsPerWeek: number[]
  winnings: number
  serums: number
  weapons: number
  weekKilled: number | null
  killedByRosterId: string | null
}

export interface ZombieMovementProjection {
  rosterId: string
  leagueId: string
  currentLevelId: string
  projectedLevelId: string
  projectedLevelName?: string | null
  reason: string
}
