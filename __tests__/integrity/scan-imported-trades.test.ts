import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/integrity/leagueEntitlement', () => ({ checkLeagueCommissionerEntitlement: vi.fn() }))
const engine = vi.hoisted(() => ({ scanTradeForCollusion: vi.fn() }))
vi.mock('@/lib/integrity/CollusionDetectionEngine', () => engine)

import { importedTradeScanMarkerKey, scanCompletedImportedTrades, type ImportedTradeScanDeps } from '@/lib/integrity/scanImportedTrades'

function deps(over: Partial<ImportedTradeScanDeps> = {}) {
  const claimed = new Set<string>()
  return {
    entitled: vi.fn(async () => true),
    onLedger: vi.fn(async () => true),
    claim: vi.fn(async (key: string) => (claimed.has(key) ? false : (claimed.add(key), true))),
    release: vi.fn(async (key: string) => void claimed.delete(key)),
    scan: vi.fn(async () => ({ flags: [] })),
    ...over,
  }
}

beforeEach(() => vi.clearAllMocks())

describe('scanCompletedImportedTrades', () => {
  it('scans each completed trade once per entitled AF copy of the league', async () => {
    const d = deps({ entitled: vi.fn(async (id: string) => id !== 'copy-free') })
    const r = await scanCompletedImportedTrades({ leagueIds: ['copy-paid', 'copy-free'], providerTradeIds: ['t1', 't2'] }, d)
    expect(d.scan.mock.calls).toEqual([
      ['copy-paid', 't1'],
      ['copy-paid', 't2'],
    ])
    expect(r).toEqual({ scanned: 2, skipped: 2, failed: 0 })

    // The sweep reporting the same completion again does not scan it again.
    const again = await scanCompletedImportedTrades({ leagueIds: ['copy-paid'], providerTradeIds: ['t1'] }, d)
    expect(again).toEqual({ scanned: 0, skipped: 1, failed: 0 })
    expect(d.scan).toHaveBeenCalledTimes(2)
  })

  it('leaves no marker for a trade that is not on the ledger yet, so a later run still scans it', async () => {
    const d = deps({ onLedger: vi.fn(async () => false) })
    const r = await scanCompletedImportedTrades({ leagueIds: ['L1'], providerTradeIds: ['t1'] }, d)
    expect(r).toEqual({ scanned: 0, skipped: 1, failed: 0 })
    expect(d.claim).not.toHaveBeenCalled()
    expect(d.scan).not.toHaveBeenCalled()
  })

  it('releases the marker when the scan throws, and never throws itself', async () => {
    const d = deps({ scan: vi.fn(async () => { throw new Error('review down') }) })
    const r = await scanCompletedImportedTrades({ leagueIds: ['L1'], providerTradeIds: ['t1'] }, d)
    expect(r).toEqual({ scanned: 0, skipped: 0, failed: 1 })
    expect(d.release).toHaveBeenCalledWith(importedTradeScanMarkerKey('L1', 't1'))
  })

  it('reviews the trade from the stored Sleeper ledger by default', async () => {
    engine.scanTradeForCollusion.mockResolvedValue({ flags: [] })
    const { scan: _scan, ...rest } = deps()
    await scanCompletedImportedTrades({ leagueIds: ['L1'], providerTradeIds: ['t9'] }, rest)
    expect(engine.scanTradeForCollusion).toHaveBeenCalledWith('L1', 't9', { kind: 'provider', provider: 'sleeper', providerTradeId: 't9' })
  })
})
