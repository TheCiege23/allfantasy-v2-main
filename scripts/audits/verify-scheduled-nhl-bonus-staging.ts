/** Read-only smoke of the scheduled NHL bonus reconciler against staging boxes. */
import assert from 'node:assert/strict'
import { prisma } from '@/lib/prisma'
import { enrichOfficialNhlGameWinningGoals } from '@/lib/nhl-scoring/officialGameWinningGoalsIngest'
import targetGuard from '../db-target-identity.cjs'

async function main() {
  assert.equal(targetGuard.identifyTarget(process.env.DIRECT_URL || process.env.DATABASE_URL).label,
    'staging', 'STAGING_DATABASE_REQUIRED')
  const date = process.argv[2] ?? '2026-10-19'
  assert.match(date, /^\d{4}-\d{2}-\d{2}$/)
  const result = await enrichOfficialNhlGameWinningGoals({ dates: [date], dryRun: true })
  assert.equal(result.errors.length, 0, JSON.stringify(result.errors))
  assert.ok(result.matched > 0, 'NO_FINAL_NHL_SKATER_BOXES_MATCHED')
  console.log(JSON.stringify({ date, ...result }, null, 2))
}
main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
