/** Vendor-neutral contract for licensed, observed market ADP exports. No ranking-to-ADP conversion. */
import { z } from 'zod'
import { SUPPORTED_SPORTS } from '@/lib/sport-scope'

const playerSchema = z.object({
  canonicalPlayerId: z.string().trim().min(1).max(128),
  providerPlayerId: z.string().trim().min(1).max(128),
  playerName: z.string().trim().min(1).max(128),
  position: z.string().trim().min(1).max(32),
  team: z.string().trim().max(32).nullable(),
  adp: z.number().finite().positive(),
  draftSampleSize: z.number().int().positive(),
})
const boardSchema = z.object({
  evidenceType: z.literal('observed_drafts'),
  licensedForUse: z.literal(true),
  sport: z.string().refine(value => SUPPORTED_SPORTS.includes(value as never)),
  source: z.string().trim().min(1).max(32).refine(value => !['ai_adp','allfantasy_app','custom','consensus','ffc','sleeper','fantrax','espn','mfl'].includes(value.toLowerCase())),
  season: z.number().int().min(2000).max(2200),
  format: z.enum(['redraft','dynasty']),
  scoring: z.string().trim().min(1).max(32),
  asOf: z.string().datetime({ offset: true }),
  players: z.array(playerSchema).min(1).max(30000),
})
export type ObservedMarketAdpBoard = z.infer<typeof boardSchema>

export function validateObservedMarketAdpBoard(input: unknown, expected: {
  sport: string; season: number; format: 'redraft' | 'dynasty'; scoring: string
}, now = new Date()): ObservedMarketAdpBoard {
  const board = boardSchema.parse(input)
  if (board.sport !== expected.sport || board.season !== expected.season || board.format !== expected.format || board.scoring !== expected.scoring) throw new Error('ADP_BOARD_CONTEXT_MISMATCH')
  const age = now.getTime() - Date.parse(board.asOf)
  if (age < -300000 || age > 7 * 86400000) throw new Error('ADP_BOARD_AS_OF_OUT_OF_RANGE')
  const canonical = new Set<string>(), provider = new Set<string>()
  for (const player of board.players) {
    if (canonical.has(player.canonicalPlayerId) || provider.has(player.providerPlayerId)) throw new Error('ADP_BOARD_AMBIGUOUS_IDENTITY')
    canonical.add(player.canonicalPlayerId); provider.add(player.providerPlayerId)
  }
  return board
}
