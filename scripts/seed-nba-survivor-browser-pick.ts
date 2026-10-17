/** Seed one real draft-service pick for the isolated browser rehearsal. */
import { identifyTarget } from './db-target-identity.cjs'
import { submitPick } from '../lib/live-draft-engine/PickSubmissionService'
import { configureEventInfrastructure, InMemoryOutboxStore } from '../lib/events'
import { prisma } from '../lib/prisma'

async function main() {
  if (process.env.AF_NBA_SURVIVOR_BROWSER_DB !== '1' || identifyTarget(process.env.DATABASE_URL).kind !== 'safe') {
    throw new Error('ALLOWLISTED_TEST_DATABASE_REQUIRED')
  }
  if (process.env.UPSTASH_REDIS_REST_URL || process.env.UPSTASH_REDIS_REST_TOKEN) {
    throw new Error('SHARED_REDIS_MUST_BE_DISABLED')
  }
  const [leagueId, madeByUserId, rosterId, playerId, playerName, position, team, overallRaw] = process.argv.slice(2)
  const expectedOverall = Number(overallRaw)
  if (!leagueId || !madeByUserId || !rosterId || !playerId || !playerName || !position || !Number.isInteger(expectedOverall) || expectedOverall < 1) {
    throw new Error('INVALID_BROWSER_PICK_FIXTURE')
  }
  configureEventInfrastructure({ outboxStore: new InMemoryOutboxStore() })
  try {
    const result = await submitPick({
      leagueId, madeByUserId, rosterId, playerId, playerName, position,
      team: team || null, source: 'user', expectedOverall,
    })
    if (!result.success) throw new Error(`BROWSER_PICK_FIXTURE_FAILED: ${result.code ?? result.error}`)
    process.stdout.write(`seeded browser pick ${expectedOverall}\n`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Browser pick fixture failed'}\n`)
  process.exitCode = 1
})
