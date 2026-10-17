import { LEAGUE_CREATE_OPTIONS_CATALOG_V1 } from '@/lib/league-creation/options-catalog-seed-data'
import type { LeagueTypeId } from '@/lib/league-creation-wizard/types'
import {
  DEFAULT_V2_STATE,
  getDefaultBestBallSetup,
  getDefaultDynastySetup,
  type CreateLeagueV2State,
  type SupportedSport,
} from './state'
import {
  getDefaultTeamCount,
  getTeamCountOptions,
  resolveValidDraftTypeForSelection,
  resolveValidScoringPresetIdForSelection,
} from './rules-engine'

export type ImportedLeagueTemplateSource = {
  name: string | null
  sport: string
  leagueType: string | null
  leagueVariant: string | null
  leagueSize: number | null
  scoringPresetId: string | null
  draftType: string | null
}

/** Starts a fresh native league using only valid, editable setup choices from an import. */
export function createStateFromImportedLeague(source: ImportedLeagueTemplateSource): CreateLeagueV2State {
  const catalog = LEAGUE_CREATE_OPTIONS_CATALOG_V1
  const sport = (catalog.sports as readonly string[]).includes(source.sport)
    ? source.sport as SupportedSport
    : DEFAULT_V2_STATE.sport
  const rawType = String(source.leagueType ?? '').trim().toLowerCase()
  const idpSelected = (rawType === 'idp' || String(source.leagueVariant ?? '').toLowerCase().includes('idp')) &&
    (sport === 'NFL' || sport === 'NCAAF')
  const leagueType = idpSelected
    ? 'redraft'
    : catalog.concepts.some((concept) => concept.id === rawType && concept.id !== 'idp') &&
        catalog.allowedSportsByConcept[rawType]?.includes(sport)
      ? rawType as LeagueTypeId
      : 'redraft'
  const soccerPipeline = sport === 'SOCCER' ? 'euro' : null
  const teamOptions = getTeamCountOptions(sport, leagueType, soccerPipeline)
  const teamCount = source.leagueSize != null && teamOptions.includes(source.leagueSize)
    ? source.leagueSize
    : getDefaultTeamCount(sport, leagueType, soccerPipeline)
  const draftType = resolveValidDraftTypeForSelection({
    leagueType,
    sport,
    idpSelected,
    currentDraftType: source.draftType ?? '',
  })
  const scoringPresetId = resolveValidScoringPresetIdForSelection(source.scoringPresetId ?? '', {
    leagueType,
    sport,
    idpSelected,
  })
  const dynasty = getDefaultDynastySetup(sport, draftType)
  const playoffTeamCount = Math.min(dynasty.playoffTeamCount, teamCount)
  const bestBall = getDefaultBestBallSetup(sport, 'standard', draftType)
  const sourceName = source.name?.trim() || 'Imported League'

  return {
    ...DEFAULT_V2_STATE,
    sport,
    leagueType,
    idpSelected,
    soccerPipeline,
    teamCount,
    draftType,
    scoringPresetId,
    name: `${sourceName} on AllFantasy`.slice(0, 100),
    nameTouched: true,
    dynasty: {
      ...dynasty,
      playoffTeamCount,
      playoffByeCount: 2 ** Math.ceil(Math.log2(playoffTeamCount)) - playoffTeamCount,
    },
    bestBall: { ...bestBall, playoffTeams: Math.min(bestBall.playoffTeams, teamCount) },
    // A new native league needs its own draft schedule. Never reuse an old provider date.
    draftDate: '',
    draftTime: '',
  }
}
