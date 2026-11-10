import 'server-only'

import { createHash } from 'node:crypto'
import { z } from 'zod'

const exportPlayer = z.object({
  fantraxId: z.string().trim().regex(/^[a-z0-9_-]{1,64}$/i),
  name: z.string().trim().min(1).max(150),
  position: z.enum(['GK', 'DEF', 'MID', 'FWD']),
  fantasyPoints: z.number().finite(),
  appearances: z.number().int().min(0).max(38),
  clubMatches: z.number().int().min(1).max(38),
}).refine((p) => p.appearances <= p.clubMatches && (p.appearances > 0 || p.fantasyPoints === 0))

/** Normalized operator capture of the league's published full player-pool totals, including free agents. */
const playerExport = z.object({
  source: z.literal('fantrax-player-export'),
  platformLeagueId: z.string().trim().min(1).max(100),
  season: z.number().int().min(2000).max(2200),
  rulesDigest: z.string().regex(/^[a-f0-9]{64}$/),
  through: z.string().datetime(),
  fullPool: z.literal(true),
  players: z.array(exportPlayer).min(40).max(2000),
}).refine((row) => new Set(row.players.map((p) => p.fantraxId)).size === row.players.length)

const MAX_AGE_MS = 21 * 86_400_000

export function fantraxSoccerExportKey(leagueId: string): string {
  return 'fantrax:soccer:player-points:' + leagueId
}

export function fantraxSoccerRulesDigest(settings: unknown): string | null {
  const row = settings as { fantrax_settings?: { scoringSystem?: { type?: string } } } | null
  const system = row?.fantrax_settings?.scoringSystem
  if (typeof system?.type !== 'string' || !system.type.includes('POINTS_BASED')) return null
  // Both callers read the same saved JSONB rules, so object key order is stable.
  return createHash('sha256').update(JSON.stringify(system)).digest('hex')
}

export function hasFantraxSoccerPool(players: readonly { fantraxId: string }[], rosteredIds: Iterable<string>): boolean {
  const board = new Set(players.map((p) => p.fantraxId))
  const held = new Set(rosteredIds)
  return held.size > 0 && board.size > held.size && [...held].every((id) => board.has(id))
}

export function validateFantraxSoccerExport(
  data: unknown,
  league: { season?: number | null; platformLeagueId?: string | null; settings: unknown },
  now: Date,
) {
  const parsed = playerExport.safeParse(data)
  if (!parsed.success) return null
  const board = parsed.data
  const date = Date.parse(board.through)
  if (board.season !== league.season || board.platformLeagueId !== league.platformLeagueId ||
      board.rulesDigest !== fantraxSoccerRulesDigest(league.settings) ||
      date > now.getTime() || now.getTime() - date >= MAX_AGE_MS) return null
  return { board, expiresAt: new Date(date + MAX_AGE_MS) }
}
