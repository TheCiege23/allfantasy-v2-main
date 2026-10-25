/**
 * domain-os-refresh asks Postgres for the distinct (format, qbFormat) pairs in one statement
 * instead of shipping the whole PlayerValueSnapshot table to Prisma's in-memory distinct.
 * Row-for-row equivalence is proven against real Postgres in
 * `value-snapshot-combos.db.integration.test.ts`; this pins the statement and the kill switch.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { loadValueSnapshotCombos } from '@/lib/player-values/valueSnapshotCombos'

function fakeClient() {
  return {
    $queryRaw: vi.fn(async () => [{ format: 'DYNASTY', qbFormat: 'SUPERFLEX' }]),
    playerValueSnapshot: { findMany: vi.fn(async () => [{ format: 'DYNASTY', qbFormat: 'SUPERFLEX' }]) },
  }
}

afterEach(() => { delete process.env.AF_READ_OPTIMIZATIONS_OFF })

describe('loadValueSnapshotCombos', () => {
  it('sends one GROUP BY statement, ordered like Prisma (first id), capped in SQL', async () => {
    const client = fakeClient()
    const out = await loadValueSnapshotCombos(24, client as never)
    expect(out).toEqual([{ format: 'DYNASTY', qbFormat: 'SUPERFLEX' }])
    expect(client.playerValueSnapshot.findMany).not.toHaveBeenCalled()
    expect(client.$queryRaw).toHaveBeenCalledTimes(1)
    const [strings, ...values] = client.$queryRaw.mock.calls[0] as unknown as [TemplateStringsArray, ...unknown[]]
    const sql = strings.join('$').replace(/\s+/g, ' ')
    expect(sql).toContain('FROM "PlayerValueSnapshot"')
    expect(sql).toContain('GROUP BY format, "qbFormat"')
    expect(sql).toContain('ORDER BY min(id)')
    expect(sql).toContain('LIMIT $')
    expect(values).toEqual([24])
  })

  it('AF_READ_OPTIMIZATIONS_OFF=value-combos restores the Prisma distinct call', async () => {
    process.env.AF_READ_OPTIMIZATIONS_OFF = 'value-combos'
    const client = fakeClient()
    await loadValueSnapshotCombos(24, client as never)
    expect(client.$queryRaw).not.toHaveBeenCalled()
    expect(client.playerValueSnapshot.findMany).toHaveBeenCalledWith({
      select: { format: true, qbFormat: true }, distinct: ['format', 'qbFormat'], take: 24,
    })
  })

  it('domain-os-refresh uses it', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('app/api/cron/domain-os-refresh/route.ts', 'utf8')
    expect(src).toMatch(/^\s*const combos = await loadValueSnapshotCombos\(APP_COMBO_CAP\)/m)
    expect(src).not.toMatch(/^\s*\.findMany\(\{ select: \{ format: true, qbFormat: true \}, distinct:/m)
  })
})
