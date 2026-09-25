/** Live PostgreSQL integration check, confined to the positively identified test database. */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import dotenv from 'dotenv'
import { createStrategyPrismaPort } from '../lib/decision-os/value-v2/strategyPrismaPort'
import { confirmStoredStrategy, readStrategy, recordStrategyObservation } from '../lib/decision-os/value-v2/strategyStore'
const require = createRequire(import.meta.url)
const { identifyTarget } = require('./db-target-identity.cjs')

async function main() {
  const env = dotenv.parse(fs.readFileSync('.env.test'))
  const url = env.DIRECT_URL || env.DATABASE_URL
  if (identifyTarget(url).label !== 'test') throw new Error('Refusing a database not positively identified as test')
  const generated = process.argv.includes('--workspace-client') ? require('@prisma/client')
    : require(path.join(os.tmpdir(), 'allfantasy-decision-os-validation/client'))
  const db = new generated.PrismaClient({ datasources: { db: { url } } })
  const port = createStrategyPrismaPort(db, generated.Prisma.DbNull)
  const scope = { userId: `strategy-proof-${randomUUID()}`, leagueId: 'decision-os-proof', season: 2026 }
  try {
    await db.$connect()
    // Concurrent initialization must converge on one owner/league/season row.
    const initial = await Promise.all([port.initialize(scope), port.initialize(scope)])
    assert.equal((initial[0] as { id: string }).id, (initial[1] as { id: string }).id)
    for (const week of [1, 2, 3]) await recordStrategyObservation(scope, {
      week, strategy: 'rebuild', materialChange: true, evidenceId: `proof:${week}`,
    }, port)
    const before = (await readStrategy(scope, port))!
    assert.equal(before.pending?.observations, 3)
    assert.equal(before.active, 'balanced')
    const request = { expectedRevision: before.revision, strategy: 'rebuild' as const, confirmed: true as const }
    const confirmations = await Promise.allSettled([confirmStoredStrategy(scope, request, port), confirmStoredStrategy(scope, request, port)])
    assert.equal(confirmations.filter(r => r.status === 'fulfilled').length, 1)
    assert.equal(await db.decisionStrategyEvent.count({ where: { ...scope, action: 'confirm' } }), 1)
    const confirmed = (await readStrategy(scope, port))!
    assert.equal(confirmed.active, 'rebuild')
    assert.equal(confirmed.pending, null)
    assert.equal(await readStrategy({ ...scope, userId: `${scope.userId}-other` }, port), null)
    // Deliberately fail the event CHECK constraint after the versioned state UPDATE.
    await assert.rejects(port.commit({ scope, previous: confirmed,
      next: { ...confirmed, active: 'balanced', revision: confirmed.revision + 1 },
      action: 'invalid' as never, evidenceId: null }))
    assert.deepEqual(await readStrategy(scope, port), confirmed)
    console.log('PostgreSQL strategy checks passed: initialization race, durable observations, owner isolation, one winning confirmation, and atomic rollback on audit failure.')
  } finally {
    await db.$transaction(async (tx: any) => {
      await tx.decisionStrategyEvent.deleteMany({ where: scope })
      await tx.decisionStrategyState.deleteMany({ where: scope })
    })
    await db.$disconnect()
  }
}
main().catch(error => { console.error(`Strategy integration verification failed (${error.code ?? error.name ?? 'unknown'}).`); process.exitCode = 1 })
