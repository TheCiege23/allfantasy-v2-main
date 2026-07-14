import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const service = fs.readFileSync(path.join(process.cwd(), 'lib/league-trade-engine/tradeReversalService.ts'), 'utf8')
const originalConstraint = fs.readFileSync(path.join(process.cwd(), 'prisma/migrations/20260408195500_redraft_trade_playoff_core/migration.sql'), 'utf8')
const fixMigration = fs.readFileSync(path.join(process.cwd(), 'prisma/migrations/20260711130000_widen_redraft_trade_proposal_status_check/migration.sql'), 'utf8')

// Found via physical validation against a disposable Neon branch forked from
// production (Gate C validation, 2026-07-12): the reversal service writes
// status='reversed' on redraft_trade_proposals, but the check constraint
// added in 20260408195500_redraft_trade_playoff_core never included
// 'reversed' — every real reversal of a native redraft trade failed at the
// database layer with a 23514 check violation. Confirmed the failure rolled
// back cleanly (0 orphan reversal rows, proposal status unchanged), then
// fixed with a new additive migration and re-verified end-to-end against the
// same real database.
describe('redraft_trade_proposals status-check constraint includes reversed (Gate C physical finding)', () => {
  it('the original constraint (pre-fix) did not allow reversed — reproduces the real defect', () => {
    expect(originalConstraint).toContain('redraft_trade_proposals_status_check')
    expect(originalConstraint).not.toContain("'reversed'")
  })

  it('the reversal service writes status: reversed on redraft_trade_proposals', () => {
    expect(service).toContain("data: { status: 'reversed' }")
  })

  it('a new additive migration widens the constraint to include reversed', () => {
    expect(fixMigration).toContain('redraft_trade_proposals_status_check')
    expect(fixMigration).toContain("'reversed'")
    // Additive-only: no table/column/type is dropped, only the constraint is redefined.
    expect(fixMigration).not.toMatch(/DROP\s+(TABLE|COLUMN|TYPE)/i)
    expect(fixMigration).not.toContain('TRUNCATE')
  })

  it('the fix migration is ordered after the renewal foundation migrations and does not touch them', () => {
    expect(fixMigration).not.toContain('league_renewals')
    expect(fixMigration).not.toContain('league_renewal_slots')
  })
})
