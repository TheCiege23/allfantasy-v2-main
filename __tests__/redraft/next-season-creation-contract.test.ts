import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const source = fs.readFileSync(path.join(process.cwd(), 'lib/redraft/renewal/createNextSeason.ts'), 'utf8')

// Physically verified end-to-end against a disposable Neon branch forked from
// production (happy path, exact-replay idempotency, unauthorized-actor
// rejection, and N1 two-concurrent-identical-requests safety — see
// docs/redraft/NEXT_SEASON_PHYSICAL_VALIDATION_REPORT.md and
// NEXT_SEASON_CONCURRENCY_REPORT.md). This source-contract test guards the
// structural properties that made those real results possible.
describe('createNextSeason — atomic transaction contract', () => {
  it('uses serializable isolation for the authoritative transaction', () => {
    expect(source).toContain("isolationLevel: 'Serializable'")
  })

  it('checks idempotency by completion key before entering the transaction', () => {
    const preTransaction = source.slice(0, source.indexOf('return prisma.$transaction('))
    expect(preTransaction).toContain('leagueRenewal.findUnique')
    expect(preTransaction).toContain('completionIdempotencyKey: input.idempotencyKey')
  })

  it('re-checks eligibility with freshly-read data inside the transaction, not the pre-transaction read', () => {
    const txBody = source.slice(source.indexOf('return prisma.$transaction('))
    expect(txBody).toContain('evaluateNextSeasonEligibility')
    expect(txBody).toContain('tx.league.findUnique')
    expect(txBody).toContain('tx.redraftSeason.findUnique')
  })

  it('creates the destination season, rosters, event, and audit all inside the same transaction callback', () => {
    const txBody = source.slice(source.indexOf('async (tx) => {'), source.lastIndexOf('isolationLevel:'))
    expect(txBody).toContain('tx.redraftSeason.create')
    expect(txBody).toContain('tx.redraftRoster.create')
    expect(txBody).toContain('emitInTx(tx, EVENT.NEXT_SEASON_CREATED')
    expect(txBody).toContain('tx.leagueAuditLog.create')
    expect(txBody).toContain('tx.leagueRenewal.')
  })

  it('does not carry forward mutable prior-season results into the destination roster shells', () => {
    const rosterCreateBlock = source.slice(source.indexOf('const rosterCreates'), source.indexOf('const createdRosters'))
    for (const staleField of ['wins:', 'losses:', 'pointsFor:', 'pointsAgainst:', 'playoffSeed:', 'streak:']) {
      expect(rosterCreateBlock).not.toContain(staleField)
    }
  })

  it('honestly marks schedule and draft configuration as deferred rather than fabricating initialization', () => {
    expect(source).toContain("scheduleStatus: 'deferred'")
    expect(source).toContain("draftStatus: 'deferred'")
  })

  it('blocked and conflict paths return structured violation codes, not generic error strings', () => {
    expect(source).toContain('eligibility.violations.map((v) => v.code)')
    expect(source).toContain('CONFLICTING_IDEMPOTENCY_PAYLOAD')
  })
})
