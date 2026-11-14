type ScoringFormat = 'PPR' | 'Half PPR' | 'Standard' | string

export type TeamPhase = 'contender' | 'competitor' | 'middle' | 'rebuild' | 'unknown'

export type ArchetypeId =
  | 'shark'
  | 'gambler'
  | 'fair_dealer'
  | 'hoarder'
  | 'rebuilder'
  | 'win_now'
  | 'passive'
  | 'unknown'

export interface EngineLeagueContext {
  leagueId: string
  leagueName: string
  sport: 'nfl'
  season: number
  numTeams: number

  scoring: {
    format: ScoringFormat
    ppr: number
    tepBonus: number
    isTEP: boolean
    isSF: boolean
    ppCarry: number
    passBonus6pt: boolean
    scoringSettings: Record<string, number>
  }

  roster: {
    positions: string[]
    starterSlots: number
    benchSlots: number
    taxiSlots: number
    irSlots: number
    idpEnabled: boolean
    idpStarterSlots: number
  }

  meta: {
    vetoRatePct: number
    tradeDeadlinePassed: boolean
    isOffseason: boolean
    weekNumber: number
  }
}

