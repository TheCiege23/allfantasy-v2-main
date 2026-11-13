/**
 * Configuration-driven defaults for redraft league creation (sport + soccer variant).
 * Adjust EURO max team count here without rewriting the wizard.
 */

import type { LeagueSport } from '@prisma/client'
import { normalizeToSupportedSport } from '@/lib/sport-scope'

export type SoccerPipeline = 'mls' | 'euro'

export type RedraftSportIntegrationDefaults = {
  standingsEnabled: boolean
  schedulesEnabled: boolean
  injuriesEnabled: boolean
  newsEnabled: boolean
  weatherEnabled: boolean
  playerPoolSource: string
  gameFeedSource: string
}

const NFL_OUTDOOR_WEATHER = true

/** Default max teams for Soccer / EURO (config knob). */
export const REDRAFT_SOCCER_EURO_MAX_TEAMS = 20

const BASE: Record<
  LeagueSport,
  Omit<RedraftSportIntegrationDefaults, never> & { maxTeams: number; mlsMaxTeams?: number }
> = {
  NFL: {
    maxTeams: 32,
    standingsEnabled: true,
    schedulesEnabled: true,
    injuriesEnabled: true,
    newsEnabled: true,
    weatherEnabled: NFL_OUTDOOR_WEATHER,
    playerPoolSource: 'af_nfl',
    gameFeedSource: 'af_nfl_schedule',
  },
  NBA: {
    maxTeams: 30,
    standingsEnabled: true,
    schedulesEnabled: true,
    injuriesEnabled: true,
    newsEnabled: true,
    weatherEnabled: false,
    playerPoolSource: 'af_nba',
    gameFeedSource: 'af_nba_schedule',
  },
  MLB: {
    maxTeams: 30,
    standingsEnabled: true,
    schedulesEnabled: true,
    injuriesEnabled: true,
    newsEnabled: true,
    weatherEnabled: true,
    playerPoolSource: 'af_mlb',
    gameFeedSource: 'af_mlb_schedule',
  },
  NHL: {
    maxTeams: 32,
    standingsEnabled: true,
    schedulesEnabled: true,
    injuriesEnabled: true,
    newsEnabled: true,
    weatherEnabled: false,
    playerPoolSource: 'af_nhl',
    gameFeedSource: 'af_nhl_schedule',
  },
  NCAAF: {
    maxTeams: 86,
    standingsEnabled: true,
    schedulesEnabled: true,
    injuriesEnabled: true,
    newsEnabled: true,
    weatherEnabled: true,
    playerPoolSource: 'af_ncaaf',
    gameFeedSource: 'af_ncaaf_schedule',
  },
  NCAAB: {
    maxTeams: 90,
    standingsEnabled: true,
    schedulesEnabled: true,
    injuriesEnabled: true,
    newsEnabled: true,
    weatherEnabled: false,
    playerPoolSource: 'af_ncaab',
    gameFeedSource: 'af_ncaab_schedule',
  },
  SOCCER: {
    maxTeams: REDRAFT_SOCCER_EURO_MAX_TEAMS,
    mlsMaxTeams: 24,
    standingsEnabled: true,
    schedulesEnabled: true,
    injuriesEnabled: true,
    newsEnabled: true,
    weatherEnabled: false,
    playerPoolSource: 'af_soccer',
    gameFeedSource: 'af_soccer_schedule',
  },
}

export function getRedraftSportIntegration(
  sport: string,
  soccerPipeline?: SoccerPipeline | null
): RedraftSportIntegrationDefaults & { sportKey: LeagueSport; sportVariant: SoccerPipeline | null } {
  const s = (normalizeToSupportedSport(sport) ?? 'NFL') as LeagueSport
  const row = BASE[s]
  const integration: RedraftSportIntegrationDefaults = {
    standingsEnabled: row.standingsEnabled,
    schedulesEnabled: row.schedulesEnabled,
    injuriesEnabled: row.injuriesEnabled,
    newsEnabled: row.newsEnabled,
    weatherEnabled: row.weatherEnabled,
    playerPoolSource:
      s === 'SOCCER' && soccerPipeline === 'mls'
        ? 'af_soccer_mls'
        : s === 'SOCCER' && soccerPipeline === 'euro'
          ? 'af_soccer_euro'
          : row.playerPoolSource,
    gameFeedSource:
      s === 'SOCCER' && soccerPipeline === 'mls'
        ? 'af_soccer_mls_schedule'
        : s === 'SOCCER' && soccerPipeline === 'euro'
          ? 'af_soccer_euro_schedule'
          : row.gameFeedSource,
  }
  return {
    sportKey: s,
    sportVariant: s === 'SOCCER' ? soccerPipeline ?? 'mls' : null,
    ...integration,
  }
}

