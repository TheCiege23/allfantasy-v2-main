/**
 * Create League v2 — completion checks with user-facing messages.
 * Keeps parity with legacy `isFormComplete` rules while adding draft/scoring/team validation.
 */

import type { LeagueTypeId } from '@/lib/league-creation-wizard/types'
import type { CreateLeagueV2State } from './state'
import { getDefaultKeeperSetup, getEffectiveLeagueType, isDynastyConcept } from './state'
import {
  getDraftTypeOptions,
  getIdpDraftTypeOptions,
  getScoringPresetOptionsForSelection,
  getTeamCountOptions,
} from './rules-engine'
import { isUniversalTeamCount } from '@/lib/create-league-v2/simple-create'

export type CreateLeagueCompletionIssue = {
  code: string
  message: string
}

function isKeeperSetupValid(k: ReturnType<typeof getDefaultKeeperSetup>): boolean {
  if (k.keeperMaxKeepers < 1 || k.keeperMaxKeepers > 32) return false
  if (k.keeperMaxYears < 0 || k.keeperMaxYears > 20) return false
  if (k.keeperRoundPenalty < 0 || k.keeperRoundPenalty > 10) return false
  return true
}

/**
 * Returns blocking issues that prevent POST /api/leagues (or tournament create).
 */
export function analyzeCreateLeagueCompletion(state: CreateLeagueV2State): CreateLeagueCompletionIssue[] {
  const issues: CreateLeagueCompletionIssue[] = []
  const lt = getEffectiveLeagueType(state)

  if (!lt) {
    issues.push({ code: 'concept_required', message: 'Choose a league concept to continue.' })
    return issues
  }

  if (!state.sport) {
    issues.push({ code: 'sport_required', message: 'Select a sport.' })
  }

  if (!state.scoringPresetId?.trim()) {
    issues.push({ code: 'scoring_required', message: 'Choose a scoring preset.' })
  } else {
    const presetOpts = getScoringPresetOptionsForSelection({
      leagueType: lt,
      sport: state.sport,
      idpSelected: state.idpSelected,
    })
    if (presetOpts.length > 0 && !presetOpts.some((p) => p.id === state.scoringPresetId)) {
      issues.push({
        code: 'scoring_invalid',
        message: 'This scoring preset is not available for the selected sport and concept. Pick another preset.',
      })
    }
  }

  if (!(state.teamCount > 0)) {
    issues.push({ code: 'team_count_required', message: 'Choose a valid team or pool size.' })
  } else if (lt === 'redraft' && !isUniversalTeamCount(state.teamCount)) {
    issues.push({
      code: 'team_count_invalid',
      message: 'Team count must be from 2 through 32.',
    })
  } else {
    const allowedTeams = getTeamCountOptions(state.sport, lt, state.soccerPipeline)
    if (!allowedTeams.includes(state.teamCount)) {
      issues.push({
        code: 'team_count_invalid',
        message: `Team count must be one of the supported sizes for this format (${allowedTeams.slice(0, 6).join(', ')}${allowedTeams.length > 6 ? ', …' : ''}).`,
      })
    }
  }

  const nameLen = state.name.trim().length
  if (nameLen < 3 || nameLen > 100) {
    issues.push({
      code: 'league_name_invalid',
      message: 'League name must be between 3 and 100 characters.',
    })
  }

  if (!state.draftType) {
    issues.push({ code: 'draft_required', message: 'Choose a draft type.' })
  } else {
    const allowedDraftIds = new Set(
      (state.idpSelected ? getIdpDraftTypeOptions() : getDraftTypeOptions(lt, state.sport)).map((o) => o.id),
    )
    if (!allowedDraftIds.has(state.draftType)) {
      issues.push({
        code: 'draft_invalid',
        message: 'This draft type is not valid for the selected sport and league format.',
      })
    }
  }

  if (!state.draftDate.trim()) {
    issues.push({ code: 'draft_date_required', message: 'Choose a draft date.' })
  }

  if (!state.draftTime.trim()) {
    issues.push({ code: 'draft_time_required', message: 'Choose a draft time.' })
  }

  if (!state.timezone.trim()) {
    issues.push({ code: 'timezone_required', message: 'Choose a timezone.' })
  }

  if (lt === 'tournament') {
    const poolOpts = getTeamCountOptions(state.sport, lt, state.soccerPipeline)
    if (!poolOpts.includes(state.teamCount)) {
      issues.push({
        code: 'tournament_pool_invalid',
        message: 'Pick a valid tournament participant pool size.',
      })
    }
    if (state.tournamentPoolSize !== state.teamCount) {
      issues.push({
        code: 'tournament_pool_mismatch',
        message: 'Tournament pool size must match the selected tier. Re-select your pool size.',
      })
    }
  }

  if (isDynastyConcept(lt)) {
    const d = state.dynasty
    if (d.draftMode === 'scheduled' && !d.draftDateUtc.trim()) {
      issues.push({
        code: 'dynasty_draft_date',
        message: 'Set a startup draft date/time, or switch draft mode to Offline.',
      })
    }
    if (d.playoffTeamCount < 2 || d.playoffTeamCount > state.teamCount) {
      issues.push({
        code: 'dynasty_playoff_teams',
        message: `Playoff teams must be between 2 and your league size (${state.teamCount}).`,
      })
    }
    if (d.playoffByeCount < 0 || d.playoffByeCount >= d.playoffTeamCount) {
      issues.push({
        code: 'dynasty_playoff_byes',
        message: 'Playoff byes must be less than the number of playoff teams.',
      })
    }
    if (d.benchCount < 0 || d.irCount < 0 || d.taxiSlotCount < 0) {
      issues.push({
        code: 'dynasty_roster_counts',
        message: 'Bench, IR, and taxi counts cannot be negative.',
      })
    }
    if (d.rookieDraftRounds < 1 || d.futurePickTradeYears < 1) {
      issues.push({
        code: 'dynasty_rookie_future',
        message: 'Rookie draft rounds and future pick trade years must be at least 1.',
      })
    }
    if (d.waiverType === 'faab' && d.faabBudget < 1) {
      issues.push({
        code: 'dynasty_faab',
        message: 'Set a FAAB budget of at least 1, or pick a non-FAAB waiver type.',
      })
    }
  }

  if (lt === 'keeper') {
    const k = state.keeper ?? getDefaultKeeperSetup()
    if (!isKeeperSetupValid(k)) {
      issues.push({
        code: 'keeper_settings',
        message: 'Adjust keeper counts and penalties (keepers 1–32, years 0–20, round penalty 0–10).',
      })
    }
  }

  if (lt === 'best_ball') {
    const bb = state.bestBall
    if (!bb.lineupTemplateId.trim() || !bb.rosterTemplateId.trim()) {
      issues.push({
        code: 'best_ball_templates',
        message: 'Choose lineup and roster templates for Best Ball.',
      })
    }
    if (bb.regularSeasonLength < 1 || bb.regularSeasonLength > 60) {
      issues.push({
        code: 'best_ball_season',
        message: 'Regular season length must be between 1 and 60 weeks.',
      })
    }
    if (bb.playoffTeams < 0 || bb.playoffTeams > state.teamCount) {
      issues.push({
        code: 'best_ball_playoffs',
        message: 'Playoff team count cannot exceed league size.',
      })
    }
    if (bb.draftMode === 'snake' && bb.thirdRoundReversal && state.draftType !== 'snake') {
      issues.push({
        code: 'best_ball_3rr',
        message: 'Third-round reversal requires a snake draft type.',
      })
    }
  }

  return issues
}

export function isFormComplete(state: CreateLeagueV2State): boolean {
  return analyzeCreateLeagueCompletion(state).length === 0
}

/** Defaults sanity — used by tests / tooling (not all concepts have bespoke wizard fields yet). */
export function getConceptDefaultNotes(leagueType: LeagueTypeId): string {
  const map: Partial<Record<LeagueTypeId, string>> = {
    redraft: 'Seasonal refresh; typical snake or auction startup.',
    dynasty: 'Multi-year rosters; taxi + rookie drafts in Advanced.',
    keeper: 'Hold a limited number of players each season.',
    best_ball: 'Weekly optimal lineup scoring; draft modes vary by sport.',
    guillotine: 'Weekly elimination until one champion remains.',
    survivor: 'Tribe-based elimination brackets.',
    zombie: 'Thematic elimination league format.',
    tournament: 'Large participant pool split into feeder leagues.',
    salary_cap: 'Cap-based roster construction.',
    devy: 'College prospects carried through to the NFL.',
    c2c: 'College-to-pros progression league.',
    big_brother: 'Nomination-style weekly gameplay.',
  }
  return map[leagueType] ?? 'Configure draft and scoring, then review before create.'
}
