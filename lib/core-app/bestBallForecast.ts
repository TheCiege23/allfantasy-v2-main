import { isEligibleForSlot } from './rosterSlots'
import type { BestBallCandidate } from './matchupProjections'
import type { StarterGameState } from './matchupGameState'

type Edge = { to: number; reverse: number; capacity: number; cost: number }

/** Maximum-weight legal assignment. A player can fill only one starting slot. */
export function optimizeBestBall(slots: string[], players: Array<{ playerId: string; position: string; expected: number; banked: number }>) {
  if (!slots.length || !players.length || slots.length > players.length) return null
  const ordered = [...players].sort((a, b) => a.playerId.localeCompare(b.playerId))
  const sink = 1 + slots.length + ordered.length
  const graph: Edge[][] = Array.from({ length: sink + 1 }, () => [])
  const add = (from: number, to: number, capacity: number, cost: number) => {
    const forward: Edge = { to, reverse: graph[to].length, capacity, cost }
    const reverse: Edge = { to: from, reverse: graph[from].length, capacity: 0, cost: -cost }
    graph[from].push(forward)
    graph[to].push(reverse)
  }
  for (let i = 0; i < slots.length; i++) {
    add(0, 1 + i, 1, 0)
    for (let j = 0; j < ordered.length; j++) {
      if (isEligibleForSlot(slots[i], ordered[j].position)) add(1 + i, 1 + slots.length + j, 1, -Math.round(ordered[j].expected * 100))
    }
  }
  for (let j = 0; j < ordered.length; j++) add(1 + slots.length + j, sink, 1, 0)

  for (let flow = 0; flow < slots.length; flow++) {
    const distance = Array<number>(sink + 1).fill(Infinity)
    const previous = Array<{ node: number; edge: number } | null>(sink + 1).fill(null)
    distance[0] = 0
    for (let pass = 0; pass <= sink; pass++) {
      let changed = false
      for (let node = 0; node <= sink; node++) {
        if (!Number.isFinite(distance[node])) continue
        graph[node].forEach((edge, index) => {
          if (edge.capacity > 0 && distance[node] + edge.cost < distance[edge.to]) {
            distance[edge.to] = distance[node] + edge.cost
            previous[edge.to] = { node, edge: index }
            changed = true
          }
        })
      }
      if (!changed) break
    }
    if (!previous[sink]) return null
    for (let node = sink; node !== 0;) {
      const step = previous[node]!
      const edge = graph[step.node][step.edge]
      edge.capacity--
      graph[node][edge.reverse].capacity++
      node = step.node
    }
  }
  return slots.map((_, i) => {
    const edge = graph[1 + i].find((candidate) => candidate.to > slots.length && candidate.to < sink && candidate.capacity === 0)
    return edge ? ordered[edge.to - 1 - slots.length] : null
  }).filter((player): player is (typeof ordered)[number] => player !== null)
}

export function bestBallProjectedFinal(args: {
  slots: string[] | null
  candidates: BestBallCandidate[]
  actualBy: ReadonlyMap<string, number> | null
  stateBy: ReadonlyMap<string, StarterGameState>
  scoreboard: number
}): { available: true; total: number; selected: string[] } | { available: false; reason: string } {
  const { slots, candidates, actualBy, stateBy, scoreboard } = args
  if (!slots?.length) return { available: false, reason: 'the league has no verified starting-slot template' }
  if (!candidates.length) return { available: false, reason: 'the full roster is unavailable' }
  if (scoreboard !== 0 && !actualBy) return { available: false, reason: 'points are on the board but player scoring has not been imported' }
  const players: Array<{ playerId: string; position: string; expected: number; banked: number }> = []
  for (const candidate of candidates) {
    if (candidate.inactive) continue
    if (!candidate.position) return { available: false, reason: 'a roster player has no verified position' }
    const state = stateBy.get(candidate.playerId) ?? 'unknown'
    const actual = actualBy?.get(candidate.playerId)
    // A verified bye or OUT designation is enough to price zero even when no
    // scheduled game exists for this player (the normal bye-week case).
    if (state === 'unknown' && !candidate.unavailable) return { available: false, reason: 'a roster player has no verified game state' }
    if ((state === 'live' || state === 'final') && actual == null && !candidate.unavailable) {
      return { available: false, reason: 'a live or finished roster player has no imported score' }
    }
    if (candidate.projected == null && state !== 'final') {
      return { available: false, reason: 'a roster player cannot be projected under this league’s scoring rules' }
    }
    const banked = actual ?? 0
    const expected = state === 'final' || candidate.unavailable
      ? banked
      : Math.max(banked, candidate.projected ?? 0)
    players.push({ playerId: candidate.playerId, position: candidate.position, expected, banked })
  }
  const selected = optimizeBestBall(slots, players)
  if (!selected || selected.length !== slots.length) return { available: false, reason: 'eligible roster players cannot fill every starting slot' }
  // The official live Best Ball total may currently count a different legal
  // combination. Adding that total to the chosen lineup's remaining points
  // would double count players displaced by the projected optimal lineup.
  const projectedLineup = selected.reduce((sum, p) => sum + p.expected, 0)
  return {
    available: true,
    total: Math.round(Math.max(scoreboard, projectedLineup) * 100) / 100,
    selected: selected.map((p) => p.playerId),
  }
}
