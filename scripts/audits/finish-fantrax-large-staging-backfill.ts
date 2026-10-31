/** Await and record a Fantrax staging import's historical warehouse backfill. */
import assert from 'node:assert/strict'
import { prisma } from '@/lib/prisma'
import { syncFantraxHistoricalBackfillAfterImport } from '@/lib/league-import/fantrax/FantraxHistoricalBackfillService'
import { backfillSettingsPatch, readBackfillOutcome } from '@/lib/league-import/backfillOutcome'
import targetGuard from '../db-target-identity.cjs'

async function main() {
  const sourceLeagueId = process.argv[2]
  assert.match(sourceLeagueId ?? '', /^[a-z0-9]{16}$/, 'INVALID_LEAGUE_ID')
  assert.equal(targetGuard.identifyTarget(process.env.DIRECT_URL || process.env.DATABASE_URL).label,
    'staging', 'STAGING_DATABASE_REQUIRED')
  const league = await prisma.league.findFirst({
    where: { platform: 'fantrax', platformLeagueId: sourceLeagueId },
    select: { id: true, userId: true, sport: true },
  })
  assert.ok(league, 'STAGING_FANTRAX_LEAGUE_NOT_FOUND')
  const summary = await syncFantraxHistoricalBackfillAfterImport({
    leagueId: league.id, userId: league.userId,
  })
  const outcome = readBackfillOutcome(summary)
  const current = await prisma.league.findUnique({
    where: { id: league.id }, select: { settings: true },
  })
  const settings = current?.settings && typeof current.settings === 'object' && !Array.isArray(current.settings)
    ? current.settings as Record<string, unknown> : {}
  await prisma.league.update({
    where: { id: league.id },
    data: { settings: {
      ...settings,
      ...backfillSettingsPatch(outcome, new Date().toISOString()),
      historicalBackfillRosterSnapshotsPersisted: summary.rosterSnapshotsPersisted ?? null,
    } },
  })
  console.log(JSON.stringify({ target: 'staging', sourceLeagueId, sport: league.sport,
    status: outcome.status, seasonsDiscovered: outcome.seasonsDiscovered,
    seasonsImported: outcome.seasonsImported,
    rosterSnapshotsPersisted: summary.rosterSnapshotsPersisted ?? null,
    error: summary.error ?? null,
  }, null, 2))
  assert.equal(outcome.status, 'complete', 'HISTORICAL_BACKFILL_DID_NOT_COMPLETE')
}

main().catch((error) => {
  console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}).finally(() => prisma.$disconnect())
