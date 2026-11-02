/** Staging-only invocation of the existing guarded weekly NHL Fantrax identity job. */
import assert from 'node:assert/strict'
import { prisma } from '@/lib/prisma'
import { ingestNhlFantraxIdentities } from '@/lib/player-identity/ingestProFantraxIdentities'
import targetGuard from '../db-target-identity.cjs'

async function main() {
  assert.equal(targetGuard.identifyTarget(process.env.DIRECT_URL || process.env.DATABASE_URL).label,
    'staging', 'STAGING_DATABASE_REQUIRED')
  console.log(JSON.stringify(await ingestNhlFantraxIdentities(), null, 2))
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
