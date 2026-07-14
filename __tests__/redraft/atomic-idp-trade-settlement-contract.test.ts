import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const route = fs.readFileSync(path.join(process.cwd(), 'app/api/redraft/trade-votes/route.ts'), 'utf8')

describe('native redraft atomic settlement contract', () => {
  it('moves IDP cap inside the same transaction as roster and FAAB settlement', () => {
    const transaction = route.slice(route.indexOf('updated = await prisma.$transaction'), route.indexOf('// G15.2b'))
    expect(transaction).toContain('applyRedraftTradeCapTransfersInTransaction(tx')
    expect(transaction).toContain('settleRedraftTradeAssets(tx')
    expect(route).not.toContain('await applyRedraftTradeCapTransfers(')
  })

  it('rechecks deadline, acquisition, projected roster, ownership, and lock before claiming', () => {
    const claim = route.indexOf('redraftTradeProposal.updateMany')
    for (const guard of ['Trade deadline has passed.', 'evaluateRecentAcquisition', 'validateProjectedRedraftRoster', 'no longer owned', 'locked for the current scoring period']) expect(route.indexOf(guard)).toBeGreaterThan(-1)
    expect(route.indexOf('validateProjectedRedraftRoster')).toBeLessThan(claim)
  })
})
