/** Staging-only official NHL goalie reconciliation; --write persists exact final-game joins. */
import assert from 'node:assert/strict'
import { prisma } from '@/lib/prisma'
import { enrichOfficialNhlGoalieGameStats } from '@/lib/nhl-scoring/officialGoalieGameStatsIngest'
import targetGuard from '../db-target-identity.cjs'

async function main() {
  assert.equal(targetGuard.identifyTarget(process.env.DIRECT_URL || process.env.DATABASE_URL).label,
    'staging', 'STAGING_DATABASE_REQUIRED')
  const date = process.argv[2]
  assert.ok(date === '--all' || /^\d{4}-\d{2}-\d{2}$/.test(date ?? ''), 'DATE_REQUIRED')
  const write = process.argv[3] === '--write'
  const dates = date === '--all'
    ? (await prisma.playerGameStat.findMany({ where: { sportType: 'NHL', source: 'rolling_insights_live',
      gameId: { endsWith: ':goalies' } }, distinct: ['gameDate'], select: { gameDate: true },
    })).flatMap((row) => row.gameDate ? [row.gameDate.toISOString().slice(0, 10)] : []).sort()
    : [date!]
  const reports = []
  for (let start = 0; start < dates.length; start += 3) {
    const report = await enrichOfficialNhlGoalieGameStats({ dates: dates.slice(start, start + 3), dryRun: !write })
    reports.push(report)
    console.log(JSON.stringify(report))
  }
  console.log(JSON.stringify({ dates: dates.length, written: reports.reduce((n, r) => n + r.written, 0),
    wouldWrite: reports.reduce((n, r) => n + r.wouldWrite, 0),
    missing: reports.reduce((n, r) => n + r.missing, 0),
    ambiguous: reports.reduce((n, r) => n + r.ambiguous, 0),
    conflicting: reports.reduce((n, r) => n + r.conflicting, 0),
    errors: reports.flatMap((r) => r.errors) }, null, 2))
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
