import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const source = fs.readFileSync(path.join(process.cwd(), 'lib/redraft/tradeSettlement.ts'), 'utf8')

// Found via physical concurrency validation against a disposable Neon branch
// forked from production (Gate C completion phase, 2026-07-12): two real,
// concurrently-settled trades each spending 60 FAAB from a 100 balance both
// reported success, but the ledger reflected only ONE deduction (final balance
// 40, not the correctly-rejected second spend) — a classic lost-update race
// from a findUnique-then-update pattern under Postgres's default READ
// COMMITTED isolation. Fixed with a single atomic guarded UPDATE whose WHERE
// clause performs the sufficiency check in the same statement as the write.
describe('redraft FAAB settlement uses an atomic guarded UPDATE, not read-then-write', () => {
  it('does not read the roster balance before writing it (no findUnique feeding a separate update)', () => {
    const faabSection = source.slice(source.indexOf('Apply net FAAB transfers'))
    expect(faabSection).not.toContain('redraftRoster.findUnique')
  })

  it('performs the balance change and sufficiency check in one atomic statement', () => {
    const faabSection = source.slice(source.indexOf('Apply net FAAB transfers'))
    expect(faabSection).toContain('tx.$executeRaw')
    expect(faabSection).toContain('"faabBalance" = "faabBalance" +')
    // The WHERE clause's own arithmetic guard is what makes this atomic — the
    // sufficiency check must be part of the same UPDATE, not a separate query.
    expect(faabSection).toMatch(/WHERE id = .* AND .*"faabBalance".*\+.*>=\s*0/)
  })

  it('throws when the guarded UPDATE affects zero rows (insufficient balance)', () => {
    const faabSection = source.slice(source.indexOf('Apply net FAAB transfers'))
    expect(faabSection).toContain('if (updated === 0)')
    expect(faabSection).toContain('Insufficient FAAB balance to complete trade')
  })
})
