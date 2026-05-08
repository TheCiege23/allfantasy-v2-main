/**
 * One-shot helper: clear stale DraftPoolCache rows that were keyed `nflproj_v1`.
 *
 * G.1 bumped the route's cache version to `nflproj_v2`, so old `nflproj_v1` rows
 * are now unreachable but still occupying storage. They expire on their own (5-min
 * TTL), but for users on existing previews this script forces an immediate refresh
 * to the new resolver output.
 *
 * Usage (dry-run by default):
 *   npm run clear-stale-draft-pool-cache              # dry-run
 *   npm run clear-stale-draft-pool-cache -- --apply   # delete
 */
import { PrismaClient } from '@prisma/client'

const apply = process.argv.includes('--apply')
const p = new PrismaClient()
;(async () => {
  const stale = await (p as any).draftPoolCache.findMany({
    where: { cacheKey: { contains: 'nflproj_v1' } },
    select: { cacheKey: true, leagueId: true, syncedAt: true, expiresAt: true },
  })
  console.log(`[clear-stale-draft-pool-cache] mode=${apply ? 'APPLY' : 'DRY-RUN'} matches=${stale.length}`)
  for (const row of stale.slice(0, 5)) {
    console.log('  ', row.leagueId, '|', row.cacheKey, '|', row.syncedAt)
  }
  if (apply && stale.length > 0) {
    const result = await (p as any).draftPoolCache.deleteMany({
      where: { cacheKey: { contains: 'nflproj_v1' } },
    })
    console.log(`[clear-stale-draft-pool-cache] deleted=${result.count}`)
  }
  await p.$disconnect()
})().catch((err) => {
  console.error('FAIL', err)
  process.exit(1)
})
