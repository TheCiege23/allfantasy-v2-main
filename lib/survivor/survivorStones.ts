/**
 * The stones: a reproducible draw among exactly-tied managers.
 *
 * Seeded from the council (league, council, week), so the same council always draws the same
 * stone and the audit row can be replayed by anyone. Candidates are sorted first, so the order in
 * which the tally happened to list them cannot change the result.
 */

import { createHash } from 'node:crypto'

export type SurvivorStonesDraw = {
  seedLabel: string
  candidates: string[]
  eliminatedUserId: string
}

export function drawSurvivorStones(candidateUserIds: readonly string[], seedLabel: string): SurvivorStonesDraw {
  const candidates = [...new Set(candidateUserIds)].sort()
  if (candidates.length === 0) throw new Error('The stones need at least one candidate.')
  const digest = createHash('sha256').update(seedLabel).digest()
  const index = digest.readUInt32BE(0) % candidates.length
  return { seedLabel, candidates, eliminatedUserId: candidates[index]! }
}
