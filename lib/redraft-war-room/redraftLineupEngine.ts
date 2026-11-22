/**
 * REDRAFT LINEUP / START-SIT ENGINE — pure, deterministic. No AI, no fabrication.
 *
 * Greedy slot assignment that ranks eligible players by the BEST AVAILABLE value
 * signal (current-week projection → season-to-date actual average → ADP/ranking).
 * Confidence reflects the weakest signal used (ADP-based ordering is low
 * confidence). When no signal exists, it fills slots structurally and flags the
 * output instead of inventing projections.
 *
 * Honours dedicated, FLEX, and SUPERFLEX slot eligibility from the resolved roster
 * template. Redraft-only (no taxi/devy slots are treated as startable).
 */

import type { RedraftLineupSlot, RedraftPlayerFact, RedraftWarRoomContext } from './types'
import { playerValue, type ValueSource } from './playerValue'

function sourceLabel(source: ValueSource): string {
  return source === 'projection'
    ? 'projection'
    : source === 'ros_projection'
      ? 'rest-of-season projection'
    : source === 'season_avg'
      ? 'season average'
      : source === 'adp'
        ? 'ADP/ranking'
        : 'eligibility'
}

interface LineupAssignment {
  slotName: string
  playerId: string | null
  playerName: string | null
  position: string | null
  valueUsed: number | null
  valueSource: ValueSource
  reason: string
}

interface StartSitQuestion {
  position: string
  starter: { playerId: string; playerName: string; value: number | null }
  bench: { playerId: string; playerName: string; value: number | null }
  note: string
}

export interface LineupResult {
  rosterId: string
  suggestedStarters: LineupAssignment[]
  suggestedBench: Array<{ playerId: string; playerName: string; position: string; value: number | null }>
  startSitQuestions: StartSitQuestion[]
  /** 'high' | 'medium' | 'low' | 'none' based on the value signal backing the ranking. */
  confidence: 'high' | 'medium' | 'low' | 'none'
  projectedStartersPoints: number | null
  missingDataFlags: string[]
}

interface Ranked {
  player: RedraftPlayerFact
  value: number
  source: ValueSource
}

function rankValue(p: RedraftPlayerFact): Ranked {
  const v = playerValue(p)
  return { player: p, value: v.value, source: v.source }
}

function slotEligible(slot: RedraftLineupSlot, pos: string): boolean {
  if (slot.allowedPositions.length === 0) return true
  return slot.allowedPositions.includes(pos.toUpperCase())
}

/** Expand starter slots (starterCount may be > 1) into individual fillable rows. */
function expandSlots(slots: RedraftLineupSlot[]): RedraftLineupSlot[] {
  const rows: RedraftLineupSlot[] = []
  for (const s of slots) {
    for (let i = 0; i < (s.starterCount ?? 0); i++) {
      rows.push({ ...s, starterCount: 1 })
    }
  }
  // Fill dedicated/strict slots before flex/superflex so flex picks from leftovers.
  return rows.sort((a, b) => {
    const aFlex = a.isSuperflex ? 2 : a.isFlex ? 1 : 0
    const bFlex = b.isSuperflex ? 2 : b.isFlex ? 1 : 0
    return aFlex - bFlex
  })
}

export function buildLineupRecommendation(
  context: RedraftWarRoomContext,
  rosterId: string,
): LineupResult {
  const team = context.teams.find((t) => t.rosterId === rosterId)
  const missingDataFlags = [...context.missingDataFlags]
  if (!team) {
    return {
      rosterId,
      suggestedStarters: [],
      suggestedBench: [],
      startSitQuestions: [],
      confidence: 'none',
      projectedStartersPoints: null,
      missingDataFlags: ['Roster not found in this season.'],
    }
  }

  const ranked = team.players.map(rankValue).sort((a, b) => b.value - a.value)
  const usedPlayerIds = new Set<string>()
  const rows = expandSlots(context.roster.lineupSlots)
  const starters: LineupAssignment[] = []

  const anySignal = ranked.some((r) => r.source !== 'none')

  for (const slot of rows) {
    // Prefer non-injured eligible players; injury only breaks ties downward.
    const candidate = ranked.find(
      (r) =>
        !usedPlayerIds.has(r.player.playerId) &&
        slotEligible(slot, r.player.position),
    )
    if (!candidate) {
      starters.push({
        slotName: slot.slotName,
        playerId: null,
        playerName: null,
        position: null,
        valueUsed: null,
        valueSource: 'none',
        reason: `No eligible player available for ${slot.slotName}.`,
      })
      continue
    }
    usedPlayerIds.add(candidate.player.playerId)
    const injuryNote = candidate.player.injuryStatus && !/^(healthy|active|ok)$/i.test(candidate.player.injuryStatus)
      ? ` (listed ${candidate.player.injuryStatus})`
      : ''
    starters.push({
      slotName: slot.slotName,
      playerId: candidate.player.playerId,
      playerName: candidate.player.playerName,
      position: candidate.player.position,
      valueUsed: candidate.source === 'none' ? null : Math.round(candidate.value * 100) / 100,
      valueSource: candidate.source,
      reason:
        candidate.source === 'none'
          ? `Placed by eligibility only — no projection, stat, or ranking signal${injuryNote}.`
          : `Top available ${candidate.player.position} by ${sourceLabel(candidate.source)}${candidate.source === 'adp' && candidate.player.adp != null ? ` (ADP ${candidate.player.adp.toFixed(1)})` : ` (${candidate.value.toFixed(1)})`}${injuryNote}.`,
    })
  }

  const bench = ranked
    .filter((r) => !usedPlayerIds.has(r.player.playerId))
    .map((r) => ({
      playerId: r.player.playerId,
      playerName: r.player.playerName,
      position: r.player.position,
      value: r.source === 'none' ? null : Math.round(r.value * 100) / 100,
    }))

  // Start/sit questions: a benched player within 15% of a same-eligible starter's value.
  const startSitQuestions: StartSitQuestion[] = []
  if (anySignal) {
    for (const benchPlayer of ranked.filter((r) => !usedPlayerIds.has(r.player.playerId) && r.source !== 'none')) {
      const rival = starters.find(
        (s) =>
          s.playerId != null &&
          s.valueUsed != null &&
          s.position === benchPlayer.player.position &&
          benchPlayer.value >= s.valueUsed * 0.85 &&
          benchPlayer.value <= s.valueUsed,
      )
      if (rival && rival.playerId && rival.valueUsed != null) {
        startSitQuestions.push({
          position: benchPlayer.player.position,
          starter: { playerId: rival.playerId, playerName: rival.playerName!, value: rival.valueUsed },
          bench: {
            playerId: benchPlayer.player.playerId,
            playerName: benchPlayer.player.playerName,
            value: Math.round(benchPlayer.value * 100) / 100,
          },
          note: `Close call at ${benchPlayer.player.position} — values within 15%.`,
        })
      }
    }
  }

  const projectedStartersPoints =
    context.availability.projections === 'available'
      ? Math.round(
          starters.reduce((sum, s) => sum + (s.valueSource === 'projection' ? (s.valueUsed ?? 0) : 0), 0) * 100,
        ) / 100
      : null

  // Confidence reflects the WEAKEST signal among the filled starters (a lineup
  // ranked partly on ADP is only as trustworthy as that fallback).
  const filledSources = starters.filter((s) => s.playerId != null).map((s) => s.valueSource)
  let confidence: LineupResult['confidence']
  if (!anySignal || filledSources.length === 0) confidence = 'none'
  else if (filledSources.some((s) => s === 'none')) confidence = 'low'
  else if (filledSources.some((s) => s === 'adp')) confidence = 'low'
  else if (filledSources.some((s) => s === 'ros_projection')) confidence = 'medium'
  else if (filledSources.some((s) => s === 'season_avg')) confidence = 'medium'
  else confidence = 'high'

  if (!anySignal) {
    missingDataFlags.push('Start/sit ordering is structural only — no projections, stats, or rankings to rank starters.')
  } else if (confidence === 'low') {
    missingDataFlags.push('Start/sit is low confidence — based partly on ADP/ranking rather than weekly projections.')
  }

  return {
    rosterId,
    suggestedStarters: starters,
    suggestedBench: bench,
    startSitQuestions,
    confidence,
    projectedStartersPoints,
    missingDataFlags: [...new Set(missingDataFlags)],
  }
}
