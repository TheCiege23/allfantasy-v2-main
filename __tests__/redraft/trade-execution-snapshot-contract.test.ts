import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const schema = fs.readFileSync(path.join(process.cwd(), 'prisma/schema.prisma'), 'utf8')
const migration = fs.readFileSync(path.join(process.cwd(), 'prisma/migrations/20260711110000_add_trade_execution_snapshots/migration.sql'), 'utf8')
const route = fs.readFileSync(path.join(process.cwd(), 'app/api/redraft/trade-votes/route.ts'), 'utf8')

describe('immutable trade execution evidence contract', () => {
  it('defines unique immutable execution identity independent of renewal tables', () => {
    expect(schema).toContain('model TradeExecutionSnapshot')
    expect(schema).toContain('executionIdempotencyKey String   @unique')
    expect(schema).toContain('eventId                 String   @unique')
    expect(migration).not.toContain('league_renewals')
    expect(migration).not.toMatch(/DROP\s+(TABLE|COLUMN|TYPE)/i)
  })

  it('persists before and after state with the canonical event inside settlement', () => {
    const tx = route.slice(route.indexOf('updated = await prisma.$transaction'), route.indexOf('// Compatibility events'))
    for (const evidence of ['beforeRosters', 'beforePlayers', 'beforeSalaries', 'afterRosters', 'afterPlayers', 'afterSalaries']) expect(tx).toContain(evidence)
    expect(tx).toContain('emitInTx(tx, EVENT.TRADE_EXECUTED')
    expect(tx).toContain('tx.tradeExecutionSnapshot.create')
    expect(tx).toContain("actionType: 'trade_execution_snapshot_created'")
  })

  it('defines immutable reversal identities without enabling an unsafe mutation path', () => {
    expect(schema).toContain('model TradeReversal')
    expect(schema).toContain('idempotencyKey String   @unique')
    expect(migration).toContain('CREATE TABLE "trade_reversals"')
    expect(migration).toContain('trade_reversals_snapshotId_key')
  })
})
