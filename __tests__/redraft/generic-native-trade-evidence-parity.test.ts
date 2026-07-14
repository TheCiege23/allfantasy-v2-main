import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const native = fs.readFileSync(path.join(process.cwd(), 'app/api/redraft/trade-votes/route.ts'), 'utf8')
const generic = fs.readFileSync(path.join(process.cwd(), 'lib/league-trade-engine/tradeService.ts'), 'utf8')
// The generic engine's snapshot-writing has been observed both inlined directly
// in tradeService.ts and extracted into a separate shared module
// (lib/league-trade-engine/tradeExecutionSnapshotWriter.ts, calling
// recordTradeExecutionSnapshot) across different points in this repo's history —
// read defensively so this test verifies the real, current shape either way
// instead of hard-failing on ENOENT when the extraction isn't present.
const writerPath = path.join(process.cwd(), 'lib/league-trade-engine/tradeExecutionSnapshotWriter.ts')
const genericCombined = generic + (fs.existsSync(writerPath) ? fs.readFileSync(writerPath, 'utf8') : '')

describe('generic and native trade execution evidence parity', () => {
  it('creates the same canonical artifacts inside both execution transactions', () => {
    expect(native).toContain('emitInTx(tx, EVENT.TRADE_EXECUTED')
    expect(native).toContain('tx.tradeExecutionSnapshot.create')
    expect(native).toContain("actionType: 'trade_execution_snapshot_created'")
    expect(native).toContain('beforeRosters')
    expect(native).toContain('afterRosters')
    expect(native).toContain('beforeSalaries')
    expect(native).toContain('afterSalaries')
    expect(native).toContain('executionIdempotencyKey')

    expect(genericCombined).toContain('emitInTx(tx, EVENT.TRADE_EXECUTED')
    expect(genericCombined).toContain('tx.tradeExecutionSnapshot.create')
    expect(genericCombined).toContain("actionType: 'trade_execution_snapshot_created'")
    expect(genericCombined).toContain('beforeRosters')
    expect(genericCombined).toContain('afterRosters')
    expect(genericCombined).toContain('beforeSalaries')
    expect(genericCombined).toContain('afterSalaries')
    expect(genericCombined).toContain('executionIdempotencyKey')
  })

  it('normalizes sources while retaining engine identity', () => {
    expect(native).toContain("source: 'native_redraft'")
    expect(genericCombined).toContain("source: 'generic_trade_engine'")
    expect(native).toContain('settingsVersion: settings.settingsVersion')
    expect(genericCombined).toContain('settingsVersion: settings.settingsVersion')
  })
})
