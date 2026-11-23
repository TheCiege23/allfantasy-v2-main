import { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The portal's "Recommendation record": the advice ledger graded over a partner's linked leagues only
 * (lib/chimmy-outcomes/ledgerGrading.ts recomputeLedgerForLeagues → lib/partner-portal/workspace.ts).
 */

const h = vi.hoisted(() => ({ queryRaw: vi.fn(), sportsPlayerFindMany: vi.fn(async () => []) }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: { $queryRaw: h.queryRaw, sportsPlayer: { findMany: h.sportsPlayerFindMany } } }))

import { recomputeLedgerForLeagues, recomputeLedgerRecord } from '@/lib/chimmy-outcomes/ledgerGrading'
import { buildPartnerRecord, loadPortalView, type PortalDeps } from '@/lib/partner-portal/workspace'
import type { LedgerSnapshot } from '@/lib/chimmy-outcomes/ledgerRecord'

const NOW = new Date('2026-11-15T12:00:00Z')
const kick = (week: number) => new Date(Date.UTC(2026, 8, 7 + 7 * (week - 1)))

/** Rebuild what each tagged-template call sent, nested fragments included. */
function sent(call: unknown[]): Prisma.Sql {
  const [strings, ...values] = call as [TemplateStringsArray, ...unknown[]]
  return Prisma.sql(strings, ...values)
}

function routeQueries(bench: unknown[], adds: unknown[]) {
  h.queryRaw.mockImplementation(async (...call: unknown[]) => {
    const q = sent(call).sql
    // NBA / NHL / MLB bench calls (sportBenchGrading.ts, 2026-11-23): none recorded here.
    if (q.includes('a.given_at >=')) return []
    if (q.includes('"SportsGame"')) {
      // Weeks 1–10 are over; week 11 kicks off after NOW.
      return Array.from({ length: 11 }, (_, i) => ({ week: i + 1, first: kick(i + 1), last: new Date(kick(i + 1).getTime() + 86_400_000) }))
    }
    if (q.includes('FROM chimmy_advice a')) return bench
    if (q.includes('FROM chimmy_advice')) return adds
    if (q.includes('trade_decision_snapshots')) return []
    if (q.includes('player_game_stats')) return [{ pid: 'p-add', wk: 9, p: 14 }, { pid: 'p-add', wk: 10, p: 12 }, { pid: 'p-add', wk: 8, p: 11 }]
    throw new Error(`unexpected query: ${q.slice(0, 80)}`)
  })
}

beforeEach(() => {
  h.queryRaw.mockReset()
})

describe('recomputeLedgerForLeagues', () => {
  it('🛑 scopes both advice reads to the given leagues, and hands back counts with NO user map', async () => {
    routeQueries(
      [
        { user_id: 'u1', week: 9, withdrawn: false, rec_pts: 18, alt_pts: 9 },
        { user_id: 'u2', week: 9, withdrawn: false, rec_pts: 4, alt_pts: 11 },
        { user_id: 'u3', week: 11, withdrawn: false, rec_pts: null, alt_pts: null },
      ],
      [{ user_id: 'u1', week: 8, rec_key: 'p-add', alt_key: '' }],
    )
    const ledger = await recomputeLedgerForLeagues(['L1', 'L2'], { now: NOW })
    expect(ledger).toMatchObject({ season: 2026, throughWeek: 10, bench: { right: 1, wrong: 1, pending: 1 }, pickups: { graded: 1, startable: 1 } })
    expect(ledger!.users).toEqual({})

    const all = h.queryRaw.mock.calls.map(sent).filter((s) => s.sql.includes('chimmy_advice'))
    const sportReads = all.filter((s) => s.sql.includes('a.given_at >='))
    const advice = all.filter((s) => !s.sql.includes('a.given_at >='))
    expect(advice).toHaveLength(2)
    // One per other sport, each scoped the same way.
    expect(sportReads).toHaveLength(3)
    for (const s of [...advice, ...sportReads]) {
      expect(s.sql).toMatch(/league_id = ANY\(\?::text\[\]\)/)
      expect(s.values).toContainEqual(['L1', 'L2'])
    }
  })

  it('the platform-wide rebuild is unscoped, exactly as before', async () => {
    routeQueries([], [])
    await recomputeLedgerRecord({ now: NOW })
    const all = h.queryRaw.mock.calls.map(sent).filter((s) => s.sql.includes('chimmy_advice'))
    const advice = all.filter((s) => !s.sql.includes('a.given_at >='))
    // Bench calls, the panel's pickups, and the waiver engine's scored #1 claims (its own calibration, 2026-11-20).
    expect(advice).toHaveLength(3)
    // Plus one read per other sport's bench calls (2026-11-23).
    expect(all.length - advice.length).toBe(3)
    for (const s of all) expect(s.sql).not.toContain('ANY(')
  })

  it('no leagues reads nothing', async () => {
    expect(await recomputeLedgerForLeagues([], { now: NOW })).toBeNull()
    expect(h.queryRaw).not.toHaveBeenCalled()
  })
})

const ledger = (over: Partial<LedgerSnapshot> = {}): LedgerSnapshot => ({
  season: 2026,
  throughWeek: 10,
  bench: { right: 0, wrong: 0, same: 0, gain: 0, pending: 0, unscored: 0, withdrawn: 0 },
  pickups: { graded: 0, startable: 0, vsDrop: 0, beatDrop: 0, lostDrop: 0, pending: 0, noStats: 0 },
  trades: { byLetter: {}, pending: 0, unscored: 0, read: 0, gradable: 0 },
  users: {},
  ...over,
})

describe('buildPartnerRecord', () => {
  it('a rate only once the sample is big enough; counts before that', () => {
    const small = buildPartnerRecord(ledger({ bench: { right: 8, wrong: 4, same: 2, gain: 30, pending: 3, unscored: 0, withdrawn: 0 } }))
    expect(small?.startSit).toEqual({ right: 8, wrong: 4, same: 2, ratePct: null, gainPerCall: null, pending: 3 })
    expect(small?.minSample).toBe(30)

    const big = buildPartnerRecord(ledger({ bench: { right: 24, wrong: 8, same: 4, gain: 90, pending: 0, unscored: 0, withdrawn: 0 } }))
    expect(big?.startSit).toMatchObject({ ratePct: 75, gainPerCall: 2.5 })
  })

  it('only-pending is shown as pending, and nothing at all is null', () => {
    expect(buildPartnerRecord(ledger({ pickups: { graded: 0, startable: 0, vsDrop: 0, beatDrop: 0, lostDrop: 0, pending: 4, noStats: 0 } }))?.pickups).toMatchObject({
      graded: 0,
      pending: 4,
    })
    expect(buildPartnerRecord(ledger())).toBeNull()
    expect(buildPartnerRecord(null)).toBeNull()
  })
})

describe('loadPortalView — the record', () => {
  const deps = (over: Partial<PortalDeps> = {}): PortalDeps => ({
    resolveTenantsForUser: vi.fn(async () => [{ tenantId: 't', role: 'TENANT_OWNER' as const }]),
    authorizeRead: vi.fn(async () => true),
    readWorkspace: vi.fn(async () => ({
      name: 'Acme',
      bindings: [
        { id: 'b1', leagueId: 'L1', provider: 'sleeper', status: 'OK', consecutiveFailures: 0, lastSyncedAt: NOW, lastErrorAt: null, lastErrorSummary: null },
        { id: 'b2', leagueId: 'L1', provider: 'yahoo', status: 'OK', consecutiveFailures: 0, lastSyncedAt: NOW, lastErrorAt: null, lastErrorSummary: null },
      ],
    })),
    readLeagueFacts: vi.fn(async () => ({ leagues: [{ id: 'L1', name: 'One', sport: 'NFL' }], snapshots: [], managers: [] })),
    now: () => NOW,
    ...over,
  })

  it('🛑 is read for the bound leagues only, de-duplicated', async () => {
    const read = vi.fn(async () => ledger({ bench: { right: 3, wrong: 1, same: 0, gain: 10, pending: 0, unscored: 0, withdrawn: 0 } }))
    const v = await loadPortalView({ id: 'u', label: 'u' }, deps({ readRecommendationRecord: read }))
    expect(read).toHaveBeenCalledWith(['L1'])
    expect(v.kind === 'ok' && v.record?.startSit?.right).toBe(3)
  })

  it('a failed read is said on the card; the rest of the portal still renders', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const v = await loadPortalView({ id: 'u', label: 'u' }, deps({ readRecommendationRecord: vi.fn(async () => { throw new Error('boom') }) }))
    spy.mockRestore()
    expect(v.kind).toBe('ok')
    expect(v.kind === 'ok' && [v.record, v.recordUnavailable, v.leagues.length]).toEqual([null, true, 1])
  })

  it('no linked leagues never asks for a record', async () => {
    const read = vi.fn()
    await loadPortalView({ id: 'u', label: 'u' }, deps({ readRecommendationRecord: read, readWorkspace: vi.fn(async () => ({ name: 'A', bindings: [] })) }))
    expect(read).not.toHaveBeenCalled()
  })
})

describe('the partner record carries the trade letters graded in its leagues (2026-11-22)', () => {
  it('only letters with enough deals, per sport and measure; a record of trades alone is still a record', () => {
    const rec = buildPartnerRecord(ledger({
      bench: { right: 0, wrong: 0, same: 0, gain: 0, pending: 0, unscored: 0, withdrawn: 0 },
      pickups: { graded: 0, startable: 0, vsDrop: 0, beatDrop: 0, lostDrop: 0, pending: 0, noStats: 0 },
      tradeOutcomes: {
        'NFL:value': { sport: 'NFL', kind: 'value', byLetter: { A: { n: 24, net: 12.5, ahead: 17, behind: 7 }, B: { n: 3, net: 1, ahead: 2, behind: 1 } }, pending: 0, unscored: 0, gradable: 27, skips: {}, letters: {} },
        'NBA:points': { sport: 'NBA', kind: 'points', byLetter: { D: { n: 30, net: 2.1, ahead: 18, behind: 12 } }, pending: 0, unscored: 0, gradable: 30, skips: {}, letters: {} },
      },
    }))
    expect(rec).not.toBeNull()
    const letters = rec!.trades.flatMap((b) => b.letters.map((t) => `${b.sport}:${b.kind}:${t.letter}:${t.n}`)).sort()
    // B has 3 deals — under the sample floor, so it is not shown.
    expect(letters).toEqual(['NBA:points:D:30', 'NFL:value:A:24'])
  })
})
