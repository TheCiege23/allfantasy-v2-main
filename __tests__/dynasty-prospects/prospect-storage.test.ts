// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The default client must never be reached in these tests: every call passes its own `db`, and the
 * flag-off cases pass none at all — so touching this proxy means a read or write ran when it should
 * not have.
 */
vi.mock('@/lib/prisma', () => ({
  prisma: new Proxy(
    {},
    {
      get(_t, prop) {
        throw new Error(`default prisma client touched: ${String(prop)}`)
      },
    },
  ),
}))

import { InMemoryProspectVendor } from '@/lib/dynasty-prospects/inMemoryProspectVendor'
import {
  ingestProspectsFromVendor,
  ingestRookieEligibilityFromVendor,
  writeRookieEligibility,
} from '@/lib/dynasty-prospects/ingestProspects'
import { payloadHash, stableStringify } from '@/lib/dynasty-prospects/payloadHash'
import { parsePlayerKey, sportsPlayerKey, vendorPlayerKey } from '@/lib/dynasty-prospects/playerKey'
import { loadProspectPool, loadProspectsBySourceIds, loadRookieEligibility } from '@/lib/dynasty-prospects/prospectReads'
import { isDynastyProspectStorageEnabled } from '@/lib/dynasty-prospects/storageFlag'
import type { VendorProspectRecord } from '@/lib/dynasty-prospects/vendorAdapter'

import { fakeProspectDb } from './fakeProspectDb'

const ON = { DYNASTY_PROSPECT_STORAGE_ENABLED: '1' }
const OFF = {}

const flagg: VendorProspectRecord = {
  sourcePlayerId: 'sr-1',
  name: 'Cooper Flagg',
  position: 'F',
  birthDate: '2006-12-21',
  currentLevel: 'NCAA',
  currentTeam: 'Duke',
  draftYear: 2025,
  draftRound: 1,
  draftPick: 1,
  draftOverall: 1,
  draftTeam: 'DAL',
  raw: { fetchedAt: 'volatile-1' },
}
const second: VendorProspectRecord = { sourcePlayerId: 'sr-2', name: 'Dylan Harper', draftYear: 2025, draftOverall: 2 }
const undrafted: VendorProspectRecord = { sourcePlayerId: 'sr-3', name: 'Aaron Undrafted' }

describe('storage flag', () => {
  it('is off unless exactly 1 or true', () => {
    expect(isDynastyProspectStorageEnabled({})).toBe(false)
    expect(isDynastyProspectStorageEnabled({ DYNASTY_PROSPECT_STORAGE_ENABLED: '0' })).toBe(false)
    expect(isDynastyProspectStorageEnabled({ DYNASTY_PROSPECT_STORAGE_ENABLED: 'yes' })).toBe(false)
    expect(isDynastyProspectStorageEnabled({ DYNASTY_PROSPECT_STORAGE_ENABLED: '1' })).toBe(true)
    expect(isDynastyProspectStorageEnabled({ DYNASTY_PROSPECT_STORAGE_ENABLED: 'TRUE' })).toBe(true)
  })
})

describe('player keys are always namespaced', () => {
  it('builds and parses both id spaces', () => {
    expect(sportsPlayerKey('ck123')).toBe('sports_player:ck123')
    expect(vendorPlayerKey('sportradar', 'abc')).toBe('vendor:sportradar:abc')
    expect(parsePlayerKey('vendor:sportradar:a:b')).toEqual({ kind: 'vendor', source: 'sportradar', sourcePlayerId: 'a:b' })
    expect(parsePlayerKey('sports_player:ck123')).toEqual({ kind: 'sports_player', id: 'ck123' })
  })
  it('refuses a bare provider id', () => {
    expect(parsePlayerKey('9228')).toBeNull()
    expect(parsePlayerKey('sleeper:9228')).toBeNull()
    expect(parsePlayerKey('vendor:9228')).toBeNull()
    expect(vendorPlayerKey('Bad Source', '1')).toBeNull()
  })
})

describe('payload hash', () => {
  it('ignores key order and undefined, and sees a value change', () => {
    expect(stableStringify({ b: 1, a: [1, { d: 2, c: undefined }] })).toBe('{"a":[1,{"d":2}],"b":1}')
    expect(payloadHash({ a: 1, b: 2 })).toBe(payloadHash({ b: 2, a: 1 }))
    expect(payloadHash({ a: 1 })).not.toBe(payloadHash({ a: 2 }))
  })
})

describe('flag OFF: nothing changes and nothing is queried', () => {
  it('reads return empty without touching any client', async () => {
    await expect(loadRookieEligibility('NBA', 2026, ['sports_player:x'], { env: OFF })).resolves.toEqual(new Map())
    await expect(loadProspectPool('NBA', { env: OFF })).resolves.toEqual([])
    await expect(loadProspectsBySourceIds('NBA', 'sportradar', ['sr-1'], { env: OFF })).resolves.toEqual(new Map())
  })
  it('reads return empty from the process env when the flag is unset', async () => {
    const prev = process.env.DYNASTY_PROSPECT_STORAGE_ENABLED
    delete process.env.DYNASTY_PROSPECT_STORAGE_ENABLED
    try {
      await expect(loadProspectPool('MLB')).resolves.toEqual([])
      await expect(loadRookieEligibility('MLB', 2026, ['sports_player:x'])).resolves.toEqual(new Map())
    } finally {
      if (prev !== undefined) process.env.DYNASTY_PROSPECT_STORAGE_ENABLED = prev
    }
  })
  it('writers neither call the vendor nor the database', async () => {
    const f = fakeProspectDb()
    const vendor = new InMemoryProspectVendor({ source: 'sportradar', prospects: { NBA: [flagg] } })
    const fetch = vi.spyOn(vendor, 'fetchProspects')
    expect(await ingestProspectsFromVendor(vendor, 'NBA', { db: f.db, env: OFF })).toEqual({ status: 'disabled' })
    expect(await ingestRookieEligibilityFromVendor(vendor, 'NBA', 2026, { db: f.db, env: OFF })).toEqual({ status: 'disabled' })
    expect(fetch).not.toHaveBeenCalled()
    expect(f.calls).toEqual([])
  })
})

describe('writer: prospects', () => {
  let f: ReturnType<typeof fakeProspectDb>
  beforeEach(() => {
    f = fakeProspectDb()
  })

  it('creates, then is idempotent on an unchanged re-run (no upsert, lastSyncedAt moves)', async () => {
    const vendor = new InMemoryProspectVendor({ source: 'sportradar', prospects: { NBA: [flagg, second] } })
    const first = await ingestProspectsFromVendor(vendor, 'NBA', { db: f.db, env: ON, now: new Date('2026-10-01T00:00:00Z') })
    expect(first).toMatchObject({ status: 'ok', created: 2, updated: 0, unchanged: 0 })
    expect(f.prospectPlayer.rows).toHaveLength(2)

    // Only `raw` changes — it is stored, not hashed, so this is NOT a content change.
    vendor.setProspects('NBA', [{ ...flagg, raw: { fetchedAt: 'volatile-2' } }, second])
    f.calls.length = 0
    const again = await ingestProspectsFromVendor(vendor, 'NBA', { db: f.db, env: ON, now: new Date('2026-10-08T00:00:00Z') })
    expect(again).toMatchObject({ status: 'ok', created: 0, updated: 0, unchanged: 2 })
    expect(f.calls).not.toContain('prospectPlayer.upsert')
    expect(f.prospectPlayer.rows).toHaveLength(2)
    expect(f.prospectPlayer.rows.every((r) => r.lastSyncedAt.toISOString() === '2026-10-08T00:00:00.000Z')).toBe(true)
  })

  it('rewrites only the record whose content changed', async () => {
    const vendor = new InMemoryProspectVendor({ source: 'sportradar', prospects: { NBA: [flagg, second] } })
    await ingestProspectsFromVendor(vendor, 'NBA', { db: f.db, env: ON })
    vendor.setProspects('NBA', [{ ...flagg, currentTeam: 'Dallas Mavericks', status: 'graduated' }, second])
    const res = await ingestProspectsFromVendor(vendor, 'NBA', { db: f.db, env: ON })
    expect(res).toMatchObject({ created: 0, updated: 1, unchanged: 1 })
    const row = f.prospectPlayer.rows.find((r) => r.sourcePlayerId === 'sr-1')!
    expect(row).toMatchObject({ currentTeam: 'Dallas Mavericks', status: 'graduated', normalizedName: 'cooper flagg' })
    expect(row.birthDate.toISOString()).toBe('2006-12-21T00:00:00.000Z')
  })

  it('scopes by source: the same vendor id under two sources is two rows, and a read by source sees one', async () => {
    const a = new InMemoryProspectVendor({ source: 'sportradar', prospects: { NBA: [flagg] } })
    const b = new InMemoryProspectVendor({ source: 'othervendor', prospects: { NBA: [{ sourcePlayerId: 'sr-1', name: 'Someone Else' }] } })
    await ingestProspectsFromVendor(a, 'NBA', { db: f.db, env: ON })
    await ingestProspectsFromVendor(b, 'NBA', { db: f.db, env: ON })
    expect(f.prospectPlayer.rows).toHaveLength(2)
    const viaA = await loadProspectsBySourceIds('NBA', 'sportradar', ['sr-1'], { db: f.db, env: ON })
    expect(viaA.get('sr-1')?.name).toBe('Cooper Flagg')
    const viaB = await loadProspectsBySourceIds('NBA', 'othervendor', ['sr-1'], { db: f.db, env: ON })
    expect(viaB.get('sr-1')?.name).toBe('Someone Else')
  })

  it('never writes sportsPlayerId, so a re-import keeps a link the linker made', async () => {
    const vendor = new InMemoryProspectVendor({ source: 'sportradar', prospects: { NBA: [flagg] } })
    await ingestProspectsFromVendor(vendor, 'NBA', { db: f.db, env: ON })
    f.prospectPlayer.rows[0].sportsPlayerId = 'sp-flagg'
    vendor.setProspects('NBA', [{ ...flagg, currentTeam: 'Dallas Mavericks' }])
    await ingestProspectsFromVendor(vendor, 'NBA', { db: f.db, env: ON })
    expect(f.prospectPlayer.rows[0]).toMatchObject({ sportsPlayerId: 'sp-flagg', currentTeam: 'Dallas Mavericks' })
  })

  it('rejects bad records and duplicates, and refuses sports outside MLB/NBA/NHL', async () => {
    const vendor = new InMemoryProspectVendor({
      source: 'sportradar',
      prospects: { NBA: [flagg, { ...flagg, name: 'Dup' }, { sourcePlayerId: '', name: 'No Id' }, { sourcePlayerId: 'x', name: ' ' }] },
    })
    const res = await ingestProspectsFromVendor(vendor, 'NBA', { db: f.db, env: ON })
    expect(res).toMatchObject({ created: 1, received: 4 })
    expect((res as any).rejected.map((r: any) => r.reason)).toEqual(['duplicate sourcePlayerId in batch', 'missing sourcePlayerId', 'missing name'])
    expect(f.prospectPlayer.rows[0].name).toBe('Cooper Flagg')
    expect(await ingestProspectsFromVendor(vendor, 'NFL', { db: f.db, env: ON })).toMatchObject({ status: 'unsupported' })
    expect(await ingestProspectsFromVendor(vendor, 'MLB', { db: f.db, env: ON })).toMatchObject({ status: 'unsupported' })
  })
})

describe('writer: rookie eligibility', () => {
  it('upserts idempotently and refuses bare or foreign-source keys', async () => {
    const f = fakeProspectDb()
    const records = [
      { player: { kind: 'sports_player' as const, id: 'sp-1' }, isRookie: true, basis: 'drafted 2026 round 1' },
      { player: { kind: 'vendor' as const, source: 'sportradar', sourcePlayerId: 'sr-9' }, isRookie: false, basis: 'second NBA season' },
      { player: { kind: 'vendor' as const, source: 'othervendor', sourcePlayerId: 'o-1' }, isRookie: true, basis: 'x' },
      { player: { kind: 'sports_player' as const, id: '' }, isRookie: true, basis: 'x' },
      { player: { kind: 'sports_player' as const, id: 'sp-2' }, isRookie: true, basis: '  ' },
    ]
    const vendor = new InMemoryProspectVendor({ source: 'sportradar', eligibility: [{ sport: 'NBA', season: 2026, records }] })
    const first = await ingestRookieEligibilityFromVendor(vendor, 'NBA', 2026, { db: f.db, env: ON })
    expect(first).toMatchObject({ status: 'ok', created: 2, updated: 0, unchanged: 0 })
    expect((first as any).rejected.map((r: any) => r.reason)).toEqual([
      'vendor key belongs to othervendor, not sportradar',
      'player key is not namespaced',
      'missing basis',
    ])
    expect(f.rookieEligibilityRecord.rows.map((r) => r.playerKey).sort()).toEqual(['sports_player:sp-1', 'vendor:sportradar:sr-9'])
    expect(f.rookieEligibilityRecord.rows.every((r) => r.source === 'sportradar')).toBe(true)

    f.calls.length = 0
    const again = await ingestRookieEligibilityFromVendor(vendor, 'NBA', 2026, { db: f.db, env: ON })
    expect(again).toMatchObject({ created: 0, updated: 0, unchanged: 2 })
    expect(f.calls).not.toContain('rookieEligibilityRecord.upsert')
  })
})

describe('reads with the flag ON', () => {
  it('loadRookieEligibility maps by key, drops bare keys, and reports a source conflict', async () => {
    const f = fakeProspectDb()
    await writeRookieEligibility(
      { sport: 'NHL', season: 2026, source: 'eliteprospects', records: [{ player: { kind: 'sports_player', id: 'sp-1' }, isRookie: true, basis: 'drafted 2025, 3 GP' }] },
      { db: f.db, env: ON, now: new Date('2026-10-01T00:00:00Z') },
    )
    await writeRookieEligibility(
      { sport: 'NHL', season: 2026, source: 'allfantasy_rules', records: [{ player: { kind: 'sports_player', id: 'sp-1' }, isRookie: false, basis: 'career GP 30 >= 25' }] },
      { db: f.db, env: ON, now: new Date('2026-10-02T00:00:00Z') },
    )
    // A bare key must not be looked up at all, even though a row could in principle match it.
    f.rookieEligibilityRecord.rows.push({ sport: 'NHL', season: 2026, playerKey: '9228', isRookie: true, source: 'x', basis: 'x', computedAt: new Date() })

    const newestWins = await loadRookieEligibility('NHL', 2026, ['sports_player:sp-1', '9228', 'sports_player:none'], { db: f.db, env: ON })
    expect([...newestWins.keys()]).toEqual(['sports_player:sp-1'])
    expect(newestWins.get('sports_player:sp-1')).toMatchObject({ isRookie: false, source: 'allfantasy_rules', conflict: true })

    const vendorFirst = await loadRookieEligibility('NHL', 2026, ['sports_player:sp-1'], {
      db: f.db,
      env: ON,
      sourcePriority: ['eliteprospects'],
    })
    expect(vendorFirst.get('sports_player:sp-1')).toMatchObject({ isRookie: true, source: 'eliteprospects', basis: 'drafted 2025, 3 GP' })
    expect(await loadRookieEligibility('NHL', 2025, ['sports_player:sp-1'], { db: f.db, env: ON })).toEqual(new Map())
  })

  it('loadProspectPool orders by draft capital, undrafted last, and hides graduated rows by default', async () => {
    const f = fakeProspectDb()
    const vendor = new InMemoryProspectVendor({
      source: 'sportradar',
      prospects: { NBA: [undrafted, second, flagg, { sourcePlayerId: 'sr-4', name: 'Grad Uated', draftOverall: 3, status: 'graduated' }] },
    })
    await ingestProspectsFromVendor(vendor, 'NBA', { db: f.db, env: ON })
    const pool = await loadProspectPool('nba', { db: f.db, env: ON })
    expect(pool.map((p) => p.sourcePlayerId)).toEqual(['sr-1', 'sr-2', 'sr-3'])
    expect((await loadProspectPool('NBA', { db: f.db, env: ON, status: 'any' })).length).toBe(4)
    expect((await loadProspectPool('NBA', { db: f.db, env: ON, draftYear: 2025 })).length).toBe(2)
    expect(await loadProspectPool('MLB', { db: f.db, env: ON })).toEqual([])
    expect(await loadProspectPool('NFL', { db: f.db, env: ON })).toEqual([])
  })
})
