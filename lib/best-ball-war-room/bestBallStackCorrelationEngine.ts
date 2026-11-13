/**
 * BEST BALL STACK / CORRELATION ENGINE — pure, deterministic. No AI, no fabrication.
 *
 * Best-ball ceiling is amplified by CORRELATION: rostering multiple players from the same
 * real team (e.g. QB + pass-catcher) means their big weeks stack in the AUTO lineup. This
 * engine groups the roster by `SportsPlayer.team` and surfaces real same-team stacks. It
 * does NOT invent correlations — when team data is unavailable it returns a limited state.
 * Bye-week clustering is reported only when bye data is present.
 */

import type { BestBallPlayerFact, BestBallWarRoomContext } from './types'

interface BestBallStack {
  team: string
  players: Array<{ playerId: string; playerName: string; position: string }>
  /** True for a QB + pass-catcher (or skill) stack — the highest-correlation kind. */
  hasQbStack: boolean
}

interface ByeCluster {
  week: number
  count: number
  players: string[]
}

export interface BestBallStackResult {
  rosterId: string
  stacks: BestBallStack[]
  byeClusters: ByeCluster[]
  /** 'available' when team data exists, else 'limited'. */
  teamDataState: 'available' | 'limited'
  byeDataState: 'available' | 'limited'
  explanationFacts: string[]
  missingDataFlags: string[]
}

const PASS_CATCHERS = new Set(['WR', 'TE', 'RB'])

export function evaluateStacks(context: BestBallWarRoomContext, rosterId: string): BestBallStackResult {
  const team = context.teams.find((t) => t.rosterId === rosterId)
  const missingDataFlags = [...context.missingDataFlags]
  if (!team) {
    return { rosterId, stacks: [], byeClusters: [], teamDataState: 'limited', byeDataState: 'limited', explanationFacts: ['Roster not found in this league.'], missingDataFlags }
  }

  const teamDataState = context.availability.teamData === 'available' ? 'available' : 'limited'
  const byeDataState = context.availability.byeWeeks === 'available' ? 'available' : 'limited'
  const facts: string[] = []

  // Same-team stacks (real correlation).
  const byTeam = new Map<string, BestBallPlayerFact[]>()
  for (const p of team.players) {
    if (!p.team) continue
    const arr = byTeam.get(p.team) ?? []
    arr.push(p)
    byTeam.set(p.team, arr)
  }
  const stacks: BestBallStack[] = []
  for (const [tm, players] of byTeam) {
    if (players.length < 2) continue
    const hasQb = players.some((p) => p.position === 'QB')
    const hasCatcher = players.some((p) => PASS_CATCHERS.has(p.position))
    stacks.push({
      team: tm,
      players: players.map((p) => ({ playerId: p.playerId, playerName: p.playerName, position: p.position })),
      hasQbStack: hasQb && hasCatcher,
    })
  }
  stacks.sort((a, b) => b.players.length - a.players.length)

  if (teamDataState === 'limited') {
    facts.push('Stack analysis is limited — player team data is unavailable.')
  } else if (stacks.length === 0) {
    facts.push('No same-team stacks on this roster — every player is on a different team (low correlation, more stable but lower ceiling spikes).')
  } else {
    const qbStacks = stacks.filter((s) => s.hasQbStack).length
    facts.push(`${stacks.length} same-team stack(s)${qbStacks ? `, ${qbStacks} with a QB + pass-catcher (highest correlation)` : ''}.`)
  }

  // Bye clustering (only when bye data exists).
  const byeClusters: ByeCluster[] = []
  if (byeDataState === 'available') {
    const byBye = new Map<number, BestBallPlayerFact[]>()
    for (const p of team.players) {
      if (p.byeWeek == null) continue
      const arr = byBye.get(p.byeWeek) ?? []
      arr.push(p)
      byBye.set(p.byeWeek, arr)
    }
    for (const [week, players] of byBye) {
      if (players.length >= 4) {
        byeClusters.push({ week, count: players.length, players: players.map((p) => p.playerName) })
      }
    }
    byeClusters.sort((a, b) => b.count - a.count)
    if (byeClusters.length) facts.push(`Bye-week cluster risk: ${byeClusters.map((c) => `W${c.week} (${c.count})`).join(', ')}.`)
  }

  return {
    rosterId,
    stacks: stacks.slice(0, 8),
    byeClusters,
    teamDataState,
    byeDataState,
    explanationFacts: facts,
    missingDataFlags: [...new Set(missingDataFlags)],
  }
}
