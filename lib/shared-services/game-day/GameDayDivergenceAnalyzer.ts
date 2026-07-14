/**
 * Game Day Divergence Analyzer — Phase 9. Pure functions only.
 *
 * Per the brief: "Do not force a shadow comparison where no comparable
 * existing engine exists." This module does NOT invent a second scoring or
 * projection engine to diverge against — GameDayContextAssembler.ts already
 * reuses the one real canonical source (matchupCenterService.ts) directly,
 * so there is nothing independent to compare its scores/projections to.
 *
 * The one genuinely comparable pair found during the audit: this service's
 * own injury-status detection (derived from MatchupPlayerSlot.injuryStatus,
 * itself sourced through canonicalPlayerScores.ts's stat-line reading) versus
 * lib/lineup-actions/computeLineupActionsForUser's OWN, separately-implemented
 * native/Sleeper lineup scan injury detection (scanNativeLeagueLineup /
 * scanSleeperLeagueLineup) — two real, independently-coded paths that could
 * genuinely disagree about the same player. `missing_league` is also real:
 * both sources are supposed to cover the same user's connected leagues, so a
 * league appearing in one but not the other is a legitimate gap to surface.
 *
 * score_mismatch/projection_mismatch/game_state_mismatch/freshness_mismatch/
 * missing_roster/missing_player/starter_mismatch are declared in
 * GameDayDivergenceItem's category union for future use but are never
 * produced here — documented honestly, not silently omitted.
 */

import type { LineupActionItem } from '@/lib/lineup-actions/types'
import type { GameDayDivergenceItem, LeagueGameDayContext, LineupAttentionItem } from './types'

const INJURY_REASON_TYPES = new Set(['injured_starter', 'questionable_starter', 'doubtful_starter'])

export function analyzeGameDayDivergence(input: {
  leagueContexts: LeagueGameDayContext[]
  newAttentionItems: LineupAttentionItem[]
  legacyActions: LineupActionItem[]
}): GameDayDivergenceItem[] {
  const divergence: GameDayDivergenceItem[] = []

  const contextLeagueIds = new Set(input.leagueContexts.map((c) => c.leagueId))
  const legacyLeagueIds = new Set(input.legacyActions.map((a) => a.leagueId))
  for (const leagueId of legacyLeagueIds) {
    if (!contextLeagueIds.has(leagueId)) {
      divergence.push({
        category: 'missing_league',
        leagueId,
        playerId: null,
        primaryValue: 'not_assembled',
        legacyValue: 'present',
        notes: ['computeLineupActionsForUser reported this league; GameDayContextAssembler was not given it to assemble.'],
      })
    }
  }

  const legacyInjuryByPlayer = new Map<string, LineupActionItem>()
  for (const action of input.legacyActions) {
    if (action.playerId && INJURY_REASON_TYPES.has(action.reasonType)) {
      legacyInjuryByPlayer.set(`${action.leagueId}|${action.playerId}`, action)
    }
  }

  const newInjuryReasons = new Set(['starter_ruled_out', 'starter_inactive', 'starter_questionable_or_doubtful'])
  const newInjuryByPlayer = new Map<string, LineupAttentionItem>()
  for (const item of input.newAttentionItems) {
    if (item.playerId && newInjuryReasons.has(item.reasonCode)) {
      newInjuryByPlayer.set(`${item.leagueId}|${item.playerId}`, item)
    }
  }

  const allKeys = new Set([...legacyInjuryByPlayer.keys(), ...newInjuryByPlayer.keys()])
  for (const key of allKeys) {
    const legacy = legacyInjuryByPlayer.get(key)
    const mine = newInjuryByPlayer.get(key)
    const [leagueId, playerId] = key.split('|')

    if (legacy && !mine) {
      divergence.push({
        category: 'status_mismatch',
        leagueId,
        playerId,
        primaryValue: null,
        legacyValue: legacy.reasonType,
        notes: ['computeLineupActionsForUser flagged an injury-related issue this service did not independently detect.'],
      })
    } else if (mine && !legacy) {
      divergence.push({
        category: 'status_mismatch',
        leagueId,
        playerId,
        primaryValue: mine.reasonCode,
        legacyValue: null,
        notes: ['This service independently detected an injury-related issue computeLineupActionsForUser did not report.'],
      })
    } else if (legacy && mine && legacy.severity !== mine.severity) {
      divergence.push({
        category: 'alert_severity_mismatch',
        leagueId,
        playerId,
        primaryValue: mine.severity,
        legacyValue: legacy.severity,
        notes: [`Both sources flagged ${playerId}, but with different severity.`],
      })
    }
  }

  return divergence
}
