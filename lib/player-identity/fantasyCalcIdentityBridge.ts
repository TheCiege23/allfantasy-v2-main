import 'server-only'

import type { PrismaClient } from '@prisma/client'

import { prisma as defaultPrisma } from '@/lib/prisma'
import { readCachedFantasyCalcIdentities } from '@/lib/fantasycalc-db'
import { planIdentityBridge, type BridgeColumnStats, type BridgeColumn } from './identityBridgePlan'

/**
 * Fill `PlayerIdentityMap.fleaflickerId` / `.mflId` from the FantasyCalc values we already cache.
 *
 * 🛑 WHY THIS EXISTS. Fleaflicker and MFL rosters arrive under the provider's own numeric ids, which
 * overlap Sleeper's — measured on production 2026-09-27, 44 of the 248 ids on the one Fleaflicker
 * league are also real Sleeper ids — and the two bridge columns held ZERO rows. The only writer,
 * `syncIdentityMap` in `lib/unified-player-service.ts`, fetches FantasyCalc live behind a legacy
 * admin route and had never run. The cache already holds every id FantasyCalc publishes: measured
 * the same day, 218 of those 248 Fleaflicker ids (88%) reach a Sleeper id through it, none
 * ambiguously.
 *
 * DB-first by construction: it reads `sportsDataCache` (written by the FantasyCalc read-through) and
 * writes `PlayerIdentityMap`. No provider call. Scheduled as the `identityBridge` phase of
 * `/api/cron/import-players`, next to the ESPN identity ingest, bounded by the same run budget.
 *
 * Writes only onto rows that already carry the Sleeper id, only into an EMPTY column, and each
 * write re-asserts the column is still empty — a concurrent writer can never be overwritten.
 */

export type IdentityBridgeResult = {
  sourcePlayers: number
  rowsRead: number
  written: number
  deferred: number
  stats: Record<BridgeColumn, BridgeColumnStats>
}

export async function bridgeIdentityMapFromFantasyCalcCache(opts: {
  isExhausted?: () => boolean
  dryRun?: boolean
  prisma?: PrismaClient
  readSources?: typeof readCachedFantasyCalcIdentities
} = {}): Promise<IdentityBridgeResult> {
  const db = opts.prisma ?? (defaultPrisma as unknown as PrismaClient)
  const sources = await (opts.readSources ?? readCachedFantasyCalcIdentities)()

  const sleeperIds = [...new Set(sources.map((s) => String(s.sleeperId ?? '').trim()).filter(Boolean))]
  const flIds = [...new Set(sources.map((s) => String(s.fleaflickerId ?? '').trim()).filter(Boolean))]
  const mflIds = [...new Set(sources.map((s) => String(s.mflId ?? '').trim()).filter(Boolean))]

  // Every row that could matter: the players themselves, and whoever already holds one of their ids.
  const rows =
    sleeperIds.length === 0
      ? []
      : await db.playerIdentityMap.findMany({
          where: {
            sport: 'NFL',
            OR: [
              { sleeperId: { in: sleeperIds } },
              ...(flIds.length ? [{ fleaflickerId: { in: flIds } }] : []),
              ...(mflIds.length ? [{ mflId: { in: mflIds } }] : []),
            ],
          },
          select: { sleeperId: true, fleaflickerId: true, mflId: true },
        })

  const { writes, stats } = planIdentityBridge(
    sources.map((s) => ({ sleeperId: s.sleeperId, fleaflickerId: s.fleaflickerId, mflId: s.mflId })),
    rows,
  )

  let written = 0
  let deferred = 0
  for (let i = 0; i < writes.length && !opts.dryRun; i++) {
    const w = writes[i]!
    if (opts.isExhausted?.()) {
      deferred = writes.length - i
      break
    }
    const res = await db.playerIdentityMap.updateMany({
      where: { sleeperId: w.sleeperId, [w.column]: null },
      data: { [w.column]: w.value },
    })
    written += res.count
  }

  return { sourcePlayers: sources.length, rowsRead: rows.length, written, deferred, stats }
}
