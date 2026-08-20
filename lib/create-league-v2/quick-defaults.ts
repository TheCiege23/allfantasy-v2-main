/**
 * Quick Create lane — template shortcuts and default hydration.
 * Reuses preset/scoring resolution only; POST body still flows through `buildCanonicalCreatePayload`.
 */

import type { LeagueCreationTemplateId } from '@/lib/create-league-v2/templates/types'
import { getScoringPresetOptionsForSelection } from '@/lib/create-league-v2/rules-engine'
import { resolveScoringPresetId } from '@/lib/league-creation-preset/scoring-presets'
import type { CreateLeagueV2State, SupportedSport } from '@/lib/create-league-v2/state'
import {
  getDefaultBestBallSetup,
  getDefaultDynastySetup,
  getDefaultKeeperSetup,
  hydrateFootballScoringFields,
  isFootballLike,
} from '@/lib/create-league-v2/state'

export type QuickTemplateId = LeagueCreationTemplateId

function pickScoringPresetId(template: LeagueCreationTemplateId, leagueType: LeagueTypeId, sport: SupportedSport): string {
  const opts = getScoringPresetOptionsForSelection({ leagueType, sport, idpSelected: false })
  const first = opts[0]?.id ?? 'fb_half_ppr_one_qb'
  if (template === 'competitive_redraft' && isFootballLike(sport)) {
    const full = opts.find((o) => /full_ppr/i.test(o.id) || o.label.toLowerCase().includes('full ppr'))
    return resolveScoringPresetId(full?.id ?? first, { leagueType, sport, idpSelected: false })
  }
  return resolveScoringPresetId(first, { leagueType, sport, idpSelected: false })
}

function leagueTypeForTemplate(template: LeagueCreationTemplateId): LeagueTypeId {
  switch (template) {
    case 'dynasty':
      return 'dynasty'
    case 'best_ball':
      return 'best_ball'
    case 'guillotine':
      return 'guillotine'
    default:
      return 'redraft'
  }
}

/**
 * Returns a partial state patch for a Quick Create template chip.
 * Callers merge onto current state (preserve timezone, language, creationMode, etc.).
 */
export function getQuickTemplatePatch(template: LeagueCreationTemplateId, state: CreateLeagueV2State): Partial<CreateLeagueV2State> {
  const sport = state.sport
  const leagueType = leagueTypeForTemplate(template)
  const scoringPresetId = pickScoringPresetId(template, leagueType, sport)
  const footballHydration = hydrateFootballScoringFields(sport, false, scoringPresetId)

  const teamCount =
    template === 'casual_redraft'
      ? 10
      : template === 'competitive_redraft'
        ? 12
        : leagueType === 'guillotine'
          ? 12
          : 12

  const draftType = 'snake' as CreateLeagueV2State['draftType']

  const base: Partial<CreateLeagueV2State> = {
    leagueType,
    idpSelected: false,
    teamCount,
    draftType,
    scoringPresetId,
    ...footballHydration,
    standardDiscoveryVisibility: 'private',
    tradeReviewMode: 'commissioner',
    keeper: getDefaultKeeperSetup(),
  }

  if (template === 'dynasty') {
    const dynasty = getDefaultDynastySetup(sport, draftType)
    return {
      ...base,
      dynasty: {
        ...dynasty,
        draftMode: 'offline',
        draftDateUtc: '',
        visibility: 'private',
        monetization: 'free',
        entryFeeDollars: 0,
        payoutType: 'not_configured',
      },
      bestBall: getDefaultBestBallSetup(sport, 'standard', draftType),
    }
  }

  if (template === 'best_ball') {
    return {
      ...base,
      dynasty: {
        ...getDefaultDynastySetup(sport, draftType),
        draftMode: 'offline',
        draftDateUtc: '',
      },
      bestBall: {
        ...getDefaultBestBallSetup(sport, 'standard', draftType),
        visibility: 'private',
        monetization: 'free',
        entryFeeCents: 0,
        payoutType: 'not_configured',
        draftDateUtc: '',
      },
    }
  }

  return {
    ...base,
    dynasty: {
      ...getDefaultDynastySetup(sport, draftType),
      draftMode: 'offline',
      draftDateUtc: '',
    },
    bestBall: getDefaultBestBallSetup(sport, 'standard', draftType),
  }
}

/** Re-resolve scoring preset id after sport change (Quick + Advanced sport picker). */
export function resolveScoringPresetAfterSportChange(
  currentPresetId: string,
  leagueType: LeagueTypeId,
  nextSport: SupportedSport,
  idpSelected: boolean,
): string {
  return resolveScoringPresetId(currentPresetId, { leagueType, sport: nextSport, idpSelected })
}
