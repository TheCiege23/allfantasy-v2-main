import type { StartingSlot } from './types'

export interface ProjectedRosterPlayer {
  id: string
  positions: readonly string[]
  points: number | null
  /** An unavailable player cannot contribute to the evaluated period. */
  available: boolean
}
export interface OptimalLineup {
  points: number
  assignments: { slotId: string; playerId: string | null; points: number }[]
}

/** Maximum-weight bipartite matching. Reassignment handles overlapping flex slots exactly. */
export function optimalLineup(players: readonly ProjectedRosterPlayer[], topology: readonly StartingSlot[]): OptimalLineup | null {
  if (players.length > 200 || new Set(players.map(p => p.id)).size !== players.length || players.some(p => !p.id)) return null
  if (topology.some(s => !s.id || !Number.isInteger(s.count) || s.count < 0 || s.count > 40 || !s.eligiblePositions.length)) return null
  if (topology.reduce((sum, s) => sum + s.count, 0) > 40) return null
  const slots = topology.flatMap(s => Array.from({ length: s.count }, (_, i) => ({ ...s, id: `${s.id}:${i}` })))
  if (slots.length > 40 || new Set(slots.map(s => s.id)).size !== slots.length) return null
  const eligible = players.filter(p => p.available && slots.some(s => s.eligiblePositions.some(pos => p.positions.includes(pos))))
  if (eligible.some(p => p.points === null || !Number.isFinite(p.points))) return null
  type Edge = { to: number; reverse: number; capacity: number; cost: number }
  const source = 0, slotStart = 1, playerStart = slotStart + slots.length, sink = playerStart + eligible.length
  const graph: Edge[][] = Array.from({ length: sink + 1 }, () => [])
  const add = (from: number, to: number, cost: number) => {
    const forward: Edge = { to, reverse: graph[to].length, capacity: 1, cost }
    graph[from].push(forward)
    graph[to].push({ to: from, reverse: graph[from].length - 1, capacity: 0, cost: -cost })
    return forward
  }
  const choices: { slot: number; player: number; edge: Edge }[] = []
  slots.forEach((slot, s) => {
    add(source, slotStart + s, 0)
    // Leaving a slot empty is a real zero, not a replacement player invented by the engine.
    add(slotStart + s, sink, 0)
    eligible.forEach((p, i) => {
      if (slot.eligiblePositions.some(pos => p.positions.includes(pos))) {
        choices.push({ slot: s, player: i, edge: add(slotStart + s, playerStart + i, -p.points!) })
      }
    })
  })
  eligible.forEach((_, p) => add(playerStart + p, sink, 0))
  for (let flow = 0; flow < slots.length; flow++) {
    const distance = graph.map(() => Infinity), parentNode = graph.map(() => -1), parentEdge = graph.map(() => -1)
    distance[source] = 0
    for (let pass = 0; pass < graph.length - 1; pass++) {
      let changed = false
      graph.forEach((edges, from) => edges.forEach((edge, index) => {
        if (edge.capacity && distance[from] + edge.cost < distance[edge.to]) {
          distance[edge.to] = distance[from] + edge.cost
          parentNode[edge.to] = from
          parentEdge[edge.to] = index
          changed = true
        }
      }))
      if (!changed) break
    }
    if (!Number.isFinite(distance[sink])) return null
    for (let to = sink; to !== source;) {
      const from = parentNode[to], edge = graph[from][parentEdge[to]]
      edge.capacity--
      graph[to][edge.reverse].capacity++
      to = from
    }
  }
  const assignments = slots.map((slot, s) => {
    const choice = choices.find(c => c.slot === s && c.edge.capacity === 0)
    const player = choice ? eligible[choice.player] : null
    return { slotId: slot.id, playerId: player?.id ?? null, points: player?.points ?? 0 }
  })
  return { points: assignments.reduce((sum, a) => sum + a.points, 0), assignments }
}

/** Shared marginal production for trade, waiver and draft; the optimal lineup is recalculated on each side. */
export function marginalLineup(input: {
  roster: readonly ProjectedRosterPlayer[]
  add: readonly ProjectedRosterPlayer[]
  dropIds: readonly string[]
  slots: readonly StartingSlot[]
  rosterCapacity: number
  lockedPlayerIds?: readonly string[]
}) {
  const drop = new Set(input.dropIds), current = new Set(input.roster.map(p => p.id))
  if (!Number.isInteger(input.rosterCapacity) || input.rosterCapacity < 0 || input.roster.length > input.rosterCapacity) return null
  if (drop.size !== input.dropIds.length || input.dropIds.some(id => !current.has(id))) return null
  if (input.lockedPlayerIds?.some(id => drop.has(id))) return null
  if (input.add.some(p => current.has(p.id))) return null
  const afterRoster = [...input.roster.filter(p => !drop.has(p.id)), ...input.add]
  if (afterRoster.length > input.rosterCapacity) return null
  const before = optimalLineup(input.roster, input.slots), after = optimalLineup(afterRoster, input.slots)
  return before && after ? { before, after, pointsDelta: after.points - before.points } : null
}

/** Paired outcomes from the same simulation seeds; callers supply a real model's scenario results. */
export function marginalOutcomeProbability(scenarios: readonly { id: string; before: boolean; after: boolean }[]) {
  if (!scenarios.length || new Set(scenarios.map(s => s.id)).size !== scenarios.length || scenarios.some(s => !s.id)) return null
  const before = scenarios.filter(s => s.before).length / scenarios.length
  const after = scenarios.filter(s => s.after).length / scenarios.length
  return { before, after, delta: after - before, sampleSize: scenarios.length }
}
