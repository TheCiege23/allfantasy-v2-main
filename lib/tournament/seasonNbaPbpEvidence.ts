import { createHash } from 'node:crypto'
import { z } from 'zod'

const player = z.object({ id: z.union([z.string(), z.number().int().safe()]).nullish(), role: z.string().nullish(), action: z.string().nullish() }).passthrough()
const play = z.object({
  sequence: z.number().int().nonnegative(),
  action: z.string(),
  players: z.array(player).optional(),
  isReversed: z.boolean().optional(),
  details: z.object({ noPlay: z.boolean().optional(), isReversed: z.boolean().optional(), isOverruled: z.boolean().optional(), isReplayOverturned: z.boolean().optional() }).passthrough().optional(),
}).passthrough()
const envelope = z.object({ data: z.object({ NBA: z.array(z.object({ game_ID: z.string(), plays: z.array(play) }).passthrough()) }).passthrough() }).passthrough()
const foulActions = ['technical_foul_committed', 'flagrant_foul_committed'] as const
export type SeasonNbaFoulAction = typeof foulActions[number]

/** Inspect one full provider snapshot. This report does not attest feed completeness or corrections. */
export function inspectSeasonRiNbaFoulPlays(payload: unknown, expectedGameId: string) {
  const games = envelope.parse(payload).data.NBA
  if (games.length !== 1 || games[0]?.game_ID !== expectedGameId) throw new Error('NBA play-by-play must contain exactly the requested game.')
  const game = games[0]!
  const sequences = new Set<number>()
  const byPlayer = new Map<string, { technical_foul: number; flagrant_foul: number }>()
  const unattributed: Array<{ sequence: number; action: SeasonNbaFoulAction; reason: string }> = []
  const reversed: number[] = []
  for (const event of game.plays) {
    if (sequences.has(event.sequence)) throw new Error('Duplicate NBA play-by-play sequence.')
    sequences.add(event.sequence)
    if (!foulActions.includes(event.action as SeasonNbaFoulAction)) continue
    const action = event.action as SeasonNbaFoulAction
    if (event.isReversed || event.details?.noPlay || event.details?.isReversed || event.details?.isOverruled || event.details?.isReplayOverturned) {
      reversed.push(event.sequence)
      continue
    }
    const foulers = (event.players ?? []).filter(p => p.role === 'fouler' && p.action === action)
    if (foulers.length !== 1 || foulers[0]?.id == null || !/^\d+$/.test(String(foulers[0].id))) {
      unattributed.push({ sequence: event.sequence, action, reason: 'No single provider-ID fouler is proven.' })
      continue
    }
    const id = String(foulers[0].id)
    const counts = byPlayer.get(id) ?? { technical_foul: 0, flagrant_foul: 0 }
    counts[action === 'technical_foul_committed' ? 'technical_foul' : 'flagrant_foul']++
    byPlayer.set(id, counts)
  }
  return { gameId: expectedGameId, playCount: game.plays.length, attributed: Object.fromEntries([...byPlayer].sort(([a], [b]) => a.localeCompare(b))), unattributed, reversed }
}

/** Compare complete snapshots; sparse sequence numbers are identifiers, never a play count. */
export function reconcileSeasonRiNbaFoulSnapshots(previousPayload: unknown, currentPayload: unknown, expectedGameId: string) {
  const previous = inspectSeasonRiNbaFoulPlays(previousPayload, expectedGameId)
  const current = inspectSeasonRiNbaFoulPlays(currentPayload, expectedGameId)
  const previousPlays = envelope.parse(previousPayload).data.NBA[0]!.plays
  const currentPlays = envelope.parse(currentPayload).data.NBA[0]!.plays
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => [key, canonical(val)])) : value
  const entries = (plays: typeof previousPlays) => new Map(plays.map(p => [p.sequence, JSON.stringify(canonical(p))] as const))
  const before = entries(previousPlays), after = entries(currentPlays)
  const previousHighWater = Math.max(-1, ...before.keys())
  const added = [...after.keys()].filter(sequence => !before.has(sequence)).sort((a, b) => a - b)
  const removed = [...before.keys()].filter(sequence => !after.has(sequence)).sort((a, b) => a - b)
  const changed = [...before.keys()].filter(sequence => after.has(sequence) && before.get(sequence) !== after.get(sequence)).sort((a, b) => a - b)
  const backfilled = added.filter(sequence => sequence <= previousHighWater)
  const digest = (plays: typeof previousPlays) => createHash('sha256').update(JSON.stringify([...entries(plays)].sort(([a], [b]) => a - b))).digest('hex')
  const status = removed.length || changed.length || backfilled.length ? 'review_required' : added.length ? 'appended' : 'unchanged'
  return {
    gameId: expectedGameId, status, previousDigest: digest(previousPlays), currentDigest: digest(currentPlays),
    added, removed, changed, backfilled, previousFouls: previous, currentFouls: current,
  }
}
