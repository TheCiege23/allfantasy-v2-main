import 'server-only'

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { currentNcaabRosterEvidence } from '@/lib/devy/ncaabRosterPool'
import { currentNcaabSeasonYear } from '@/lib/espn/ncaabRosterSnapshot'
import { playerNamesAgree } from '@/lib/player-identity/externalIdNamespace'

const TTL_MS = 30 * 86_400_000
const PROVISIONAL_COLLEGE_SOURCE = 'allfantasy provisional ncaa production board'
const rankRow = z.object({
  playerId: z.string().regex(/^espn:ncaab:\d{1,12}$/),
  name: z.string().trim().min(1).max(150),
  rank: z.number().int().min(1).max(200),
})

const exportSchema = z.object({
  source: z.string().trim().min(1).max(80),
  publishedAt: z.string().datetime(),
  draftYear: z.number().int(),
  rankBasis: z.enum(['nba_draft_projection', 'college_production']).optional(),
  players: z.array(rankRow).min(5).max(200),
}).refine(({ players }) => new Set(players.map((row) => row.rank)).size === players.length &&
  new Set(players.map((row) => row.playerId)).size === players.length)

export type NbaProspectRank = z.infer<typeof rankRow> & { draftYear: number; publishedAt: string }
const keyFor = (year: number) => 'trade:nba:prospect-ranks:' + year

export function validateNbaProspectRanks(data: unknown, year: number, now: Date) {
  const result = exportSchema.safeParse(data)
  if (!result.success || result.data.draftYear !== year || year !== currentNcaabSeasonYear(now)) return null
  const timestamp = Date.parse(result.data.publishedAt)
  if (timestamp > now.getTime() || now.getTime() - timestamp >= TTL_MS) return null
  const board = result.data
  const pricingReady = board.rankBasis === 'nba_draft_projection' && board.source.toLowerCase() !== PROVISIONAL_COLLEGE_SOURCE
  return { board, expiresAt: new Date(timestamp + TTL_MS), pricingReady }
}

/** Import rankings that AllFantasy has permission to use, preserving the publisher's explicit ranks. */
export async function importNbaProspectRanks(data: unknown, apply: boolean, now = new Date()) {
  const year = currentNcaabSeasonYear(now)
  const validated = validateNbaProspectRanks(data, year, now)
  if (!validated) throw new Error('Supply a fresh, current NBA draft-class board with unique ranks and namespaced ESPN college IDs.')

  const { board, expiresAt, pricingReady } = validated
  if (apply && !pricingReady) throw new Error('Live NBA pricing requires a board marked nba_draft_projection. College production boards can be checked in dry-run mode.')
  const evidence = await currentNcaabRosterEvidence(prisma, now)
  const roster = new Map(evidence.athletes.map((athlete) => [athlete.id, athlete]))
  const verified = board.players.flatMap((row) => {
    const athlete = roster.get(row.playerId)
    return athlete && playerNamesAgree(athlete.name, row.name) ? [{ ...row, name: athlete.name }] : []
  })
  if (verified.length < 5) throw new Error('Fewer than five ranking entries match a current college roster by ESPN ID and name.')

  if (apply) {
    const cacheKey = keyFor(year)
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${cacheKey}, 0))`
      const current = await tx.sportsDataCache.findUnique({ where: { cacheKey }, select: { data: true } })
      const previous = validateNbaProspectRanks(current?.data, year, now)
      if (previous?.pricingReady && Date.parse(previous.board.publishedAt) >= Date.parse(board.publishedAt)) {
        throw new Error('The stored rankings have the same or a later publication timestamp.')
      }
      const ranked = { ...board, players: verified }
      await tx.sportsDataCache.upsert({
        where: { cacheKey },
        create: { cacheKey, data: ranked, expiresAt },
        update: { data: ranked, expiresAt },
      })
    })
  }
  return { draftYear: year, matched: verified.length, unmatched: board.players.length - verified.length, pricingReady, applied: apply }
}

export async function readNbaProspectRanks(year: number, now: Date): Promise<ReadonlyMap<string, NbaProspectRank>> {
  try {
    const row = await prisma.sportsDataCache.findUnique({ where: { cacheKey: keyFor(year) }, select: { data: true, expiresAt: true } })
    const valid = row && row.expiresAt > now && validateNbaProspectRanks(row.data, year, now)
    if (!valid || !valid.pricingReady) return new Map()
    const { board } = valid
    return new Map(board.players.map((player) => [player.playerId, { ...player, draftYear: year, publishedAt: board.publishedAt }]))
  } catch {
    return new Map()
  }
}
