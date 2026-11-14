import type { EngineLeagueContext } from './types'

export function normalizeLeagueContext(raw: {
  league_id?: string
  leagueId?: string
  name?: string
  leagueName?: string
  season?: string | number
  settings?: any
  scoring_settings?: any
  scoringSettings?: Record<string, number>
  roster_positions?: string[]
  rosterPositions?: string[]
  status?: string
  numTeams?: number
}): EngineLeagueContext {
  const settings = raw.settings || {}
  const scoringSettings = raw.scoring_settings || raw.scoringSettings || {}
  const rosterPositions = raw.roster_positions || raw.rosterPositions || []

  const ppr = scoringSettings.rec ?? 1
  const tepBonus = scoringSettings.bonus_rec_te ?? 0
  const passBonus = scoringSettings.pass_td ?? 4

  const sfSlots = rosterPositions.filter((p: string) => p === 'SUPER_FLEX').length
  const idpSlots = rosterPositions.filter((p: string) =>
    ['DL', 'LB', 'DB', 'IDP_FLEX', 'EDGE'].includes(p)
  ).length

  const starterSlots = rosterPositions.filter((p: string) => p !== 'BN' && p !== 'IR').length
  const benchSlots = rosterPositions.filter((p: string) => p === 'BN').length
  const irSlots = rosterPositions.filter((p: string) => p === 'IR').length

  const season = typeof raw.season === 'string' ? parseInt(raw.season) : (raw.season ?? new Date().getFullYear())

  return {
    leagueId: raw.league_id || raw.leagueId || '',
    leagueName: raw.name || raw.leagueName || 'Unknown League',
    sport: 'nfl',
    season,
    numTeams: raw.numTeams || settings.num_teams || 12,

    scoring: {
      format: ppr === 1 ? 'PPR' : ppr === 0.5 ? 'Half PPR' : 'Standard',
      ppr,
      tepBonus,
      isTEP: tepBonus > 0,
      isSF: sfSlots > 0,
      ppCarry: scoringSettings.pts_carry ?? 0,
      passBonus6pt: passBonus >= 6,
      scoringSettings,
    },

    roster: {
      positions: rosterPositions,
      starterSlots,
      benchSlots,
      taxiSlots: settings.taxi_slots ?? 0,
      irSlots,
      idpEnabled: idpSlots > 0,
      idpStarterSlots: idpSlots,
    },

    meta: {
      vetoRatePct: 0,
      tradeDeadlinePassed: false,
      isOffseason: raw.status === 'complete' || raw.status === 'pre_draft',
      weekNumber: 0,
    },
  }
}

