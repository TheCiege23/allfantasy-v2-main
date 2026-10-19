/**
 * What a divisions tournament's conference league is created WITH — the tournament's sport, its
 * conference size and the commissioner's scoring + roster choice (`formatSettings.rules`, see
 * ./rules) — expressed as the exact request body the normal create-league flow takes
 * (`POST /api/leagues` → `validateCreatePayload` → `executeCanonicalLeagueCreation`).
 *
 * The labels are only names; the presets behind them (`backing` in lib/league-labels/catalog.ts)
 * are what the wizard already sends. So this maps each label onto the wizard preset id that seeds
 * the same live preset, and nothing here invents scoring of its own.
 *
 * ⚠ The create flow picks the NFL roster SHAPE from the preset/concept, not from a separate field:
 * Superflex comes from `fb_superflex`, IDP from the `idp` concept + `fb_idp`, and both of those seed
 * Half PPR. When the tournament pairs one of those rosters with a different scoring label, the
 * league is created with the roster-defining preset and `scoringOverride` names the label's own
 * preset, which the caller writes through the league's scoring settings service afterwards.
 * Pure — no I/O.
 */
import { getRosterLabel, getScoringLabel, type LabelSport } from '@/lib/league-labels/catalog'
import type { DivisionsRules } from './rules'

type NflPresetKey = 'af_default' | 'af_ppr' | 'af_standard'

export type ConferenceLeaguePlan = {
  concept: 'redraft' | 'idp'
  scoringPreset: string
  /** Extra points per tight-end catch (TE Premium), written by the create flow itself. */
  tePremiumPoints: number | null
  /** Set when the create preset cannot express the scoring label on its own. */
  scoringOverride: { presetKey: NflPresetKey; tePremiumPoints: number | null } | null
}

export class ConferenceLeagueRulesError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConferenceLeagueRulesError'
  }
}

/** NFL scoring label → the wizard preset seeding the same live preset on a standard roster. */
const NFL_STANDARD_ROSTER_PRESET: Record<NflPresetKey, string> = { af_standard: 'fb_std', af_default: 'fb_half_ppr', af_ppr: 'fb_ppr' }
/** NBA scoring label → wizard preset (`nba_8cat` is the one that seeds `nba_8cat_standard`). */
const NBA_PRESET: Record<string, string> = { pts: 'nba_points', cat9: 'nba_9cat', cat8: 'nba_8cat' }

export function conferenceLeaguePlan(sport: LabelSport, rules: DivisionsRules): ConferenceLeaguePlan {
  const scoring = getScoringLabel(rules.scoringId)
  const roster = getRosterLabel(rules.rosterId)
  if (!scoring?.backing || !scoring.sports.includes(sport)) throw new ConferenceLeagueRulesError(`No ${sport} league preset backs the "${rules.scoringId}" scoring.`)
  if (!roster?.backing || roster.sport !== sport) throw new ConferenceLeagueRulesError(`No ${sport} league preset backs the "${rules.rosterId}" roster.`)

  if (sport === 'NBA') {
    const preset = NBA_PRESET[scoring.id]
    if (!preset || roster.backing.templateKey !== 'redraft') throw new ConferenceLeagueRulesError('That NBA scoring and roster pair has no league preset.')
    return { concept: 'redraft', scoringPreset: preset, tePremiumPoints: null, scoringOverride: null }
  }

  if (scoring.backing.kind !== 'nfl' || roster.backing.kind !== 'nfl') throw new ConferenceLeagueRulesError('That NFL scoring and roster pair has no league preset.')
  const presetKey = scoring.backing.presetKey
  const tePremiumPoints = scoring.backing.tePremiumPoints ?? null
  const template = roster.backing.templateKey
  if (template === 'redraft') return { concept: 'redraft', scoringPreset: NFL_STANDARD_ROSTER_PRESET[presetKey], tePremiumPoints, scoringOverride: null }
  // Superflex and IDP presets seed Half PPR (af_default); anything else is written over it.
  const scoringOverride = presetKey === 'af_default' ? null : { presetKey, tePremiumPoints }
  return template === 'superflex'
    ? { concept: 'redraft', scoringPreset: 'fb_superflex', tePremiumPoints, scoringOverride }
    : { concept: 'idp', scoringPreset: 'fb_idp', tePremiumPoints, scoringOverride }
}

/** The create-league request body for one conference league. */
export function conferenceLeagueCreateBody(sport: LabelSport, rules: DivisionsRules, league: { name: string; teamCount: number }) {
  const plan = conferenceLeaguePlan(sport, rules)
  return {
    plan,
    body: {
      concept: plan.concept,
      sport,
      scoringPreset: plan.scoringPreset,
      teamCount: league.teamCount,
      draftType: 'snake',
      leagueName: league.name.slice(0, 100),
      ...(plan.tePremiumPoints != null ? { conceptSetup: { tePremiumPoints: plan.tePremiumPoints } } : {}),
    },
  }
}
