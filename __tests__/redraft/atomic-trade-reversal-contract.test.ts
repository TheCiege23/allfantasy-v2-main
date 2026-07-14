import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const service = fs.readFileSync(path.join(process.cwd(), 'lib/league-trade-engine/tradeReversalService.ts'), 'utf8')
const route = fs.readFileSync(path.join(process.cwd(), 'app/api/redraft/trades/[proposalId]/reverse/route.ts'), 'utf8')
const schema = fs.readFileSync(path.join(process.cwd(), 'prisma/schema.prisma'), 'utf8')
const migration = fs.readFileSync(path.join(process.cwd(), 'prisma/migrations/20260711110000_add_trade_execution_snapshots/migration.sql'), 'utf8')

describe('atomic trade reversal service contract', () => {
  it('requires authorization, reason, snapshot readiness, and stable idempotency', () => {
    expect(service).toContain('isElevatedCommissioner')
    expect(service).toContain('Reversal reason is required')
    expect(service).toContain('evaluateTradeReversalReadiness')
    expect(service).toContain('where: { idempotencyKey: input.idempotencyKey }')
    expect(route).toContain('leagueId, reason, and idempotencyKey are required')
  })

  it('restores state and persists reversal evidence in one serializable transaction', () => {
    expect(service).toContain('Prisma.TransactionIsolationLevel.Serializable')
    for (const write of ['redraftRosterPlayer.update', 'redraftRoster.update', 'roster.update', 'redraftTradeProposal.updateMany', 'afLeagueTrade.updateMany', 'tradeReversal.create', 'leagueAuditLog.create', 'leagueEvent.create']) expect(service).toContain(write)
    expect(service).toContain('emitInTx(tx, EVENT.TRADE_REVERSED')
  })

  it('persists blocked evidence without partial restoration', () => {
    expect(service).toContain('emitInTx(tx, EVENT.TRADE_REVERSAL_BLOCKED')
    expect(service).toContain("actionType: 'trade_reversal_blocked'")
    expect(service.indexOf('if (readinessBlockers.length)')).toBeLessThan(service.indexOf("if (snapshot.tradeSource === 'native_redraft') {", service.indexOf('if (readinessBlockers.length)') + 1))
  })

  it('blocks draft and IDP cap assets that lack complete restoration evidence', () => {
    expect(service).toContain("code: 'DRAFT_ASSET_ALREADY_MOVED'")
    expect(service).toContain("code: 'IDP_CAP_DEPENDENCY'")
  })

  it('supports generic reversal evidence without a native-proposal foreign key', () => {
    const reversalModel = schema.slice(schema.indexOf('model TradeReversal {'), schema.indexOf('model RedraftTradeAsset {'))
    expect(reversalModel).not.toContain('RedraftTradeProposal @relation')
    expect(migration).not.toContain('trade_reversals_tradeId_fkey')
    expect(service).toContain('const currentById = new Map')
  })
})
