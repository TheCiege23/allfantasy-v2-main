/**
 * Staging-only: attach a Fantrax trade-history CSV export to a league already
 * imported there, through the same service the upload route uses. Makes no
 * Fantrax request.
 *
 *   node --env-file=.env.staging --require ./scripts/_audit-preload.cjs --import tsx \
 *     scripts/audits/attach-fantrax-trade-csv-staging.ts <fantrax-league-id> <path-to-csv>
 *
 * Follow it with `verify-fantrax-draft-board-staging.ts <id> --refresh` to carry
 * the picks into the app, then `verify-fantrax-trade-screen-picks-staging.ts`.
 */
import { readFileSync } from 'node:fs'
import { prisma } from '@/lib/prisma'
import { attachFantraxTradeCsv } from '@/lib/league-import/fantrax/attachFantraxTradeCsv'
import targetGuard from '../db-target-identity.cjs'

async function main() {
  const [sourceLeagueId, csvPath] = process.argv.slice(2)
  if (!/^[a-z0-9]{16}$/.test(sourceLeagueId ?? '')) throw new Error('INVALID_LEAGUE_ID')
  if (!csvPath) throw new Error('CSV_PATH_REQUIRED')
  if (targetGuard.identifyTarget(process.env.DIRECT_URL || process.env.DATABASE_URL).label !== 'staging') {
    throw new Error('STAGING_DATABASE_REQUIRED')
  }

  const owner = await prisma.fantraxLeague.findFirst({
    where: { sourceLeagueId, appUserId: { not: null } },
    orderBy: { updatedAt: 'desc' },
    select: { appUserId: true },
  })
  if (!owner?.appUserId) throw new Error('LEAGUE_NOT_IMPORTED_ON_STAGING')

  const result = await attachFantraxTradeCsv({
    appUserId: owner.appUserId,
    sourceLeagueId,
    csv: readFileSync(csvPath, 'utf8'),
  })
  console.log(JSON.stringify({ target: 'staging', sourceLeagueId, result }, null, 1))
  if (!result.ok) process.exitCode = 1
}

main()
  .catch((error) => {
    console.error(JSON.stringify({ failed: true, message: error instanceof Error ? error.message : String(error) }))
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
