import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { crosswalkAliases, gradeSportTradeRows, loadSportTradeLedger, SPORT_LEDGER_MIN_DAYS, type SportLedgerRow } from '@/lib/chimmy-outcomes/sportTradeLedger'

/* The trade outcome check for the board-valued sports (owner's call, 2026-11-22): graded by date, not NFL weeks. */

const NOW = new Date('2026-11-22T12:00:00Z')
const DAY = 86_400_000
const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`)
const row = (letter: string, capturedIso: string, get: string[], give: string[]): SportLedgerRow =>
  ({ surface: 's', letter, format: 'redraft', fromWeek: 0, getPlayerIds: get, givePlayerIds: give, nonPlayerAssets: false, isTrade: true, capturedAtMs: Date.parse(capturedIso) })

describe('gradeSportTradeRows', () => {
  const games = new Map([
    ['g', [{ dayMs: day('2026-11-01'), points: 50 }, { dayMs: day('2026-11-02'), points: 40 }, { dayMs: day('2026-11-05'), points: 30 }]],
    ['x', [{ dayMs: day('2026-11-02'), points: 10 }, { dayMs: day('2026-11-06'), points: 20 }]],
  ])

  it('counts only games on days after the grade; A held up when its side out-scored what it gave', () => {
    // Graded mid-day on the 1st: the game that day is not "after". g: 40+30 = 70, x: 10+20 = 30 → +40.
    const r = gradeSportTradeRows('NBA', [row('A', '2026-11-01T18:00:00Z', ['g'], ['x'])], games, NOW)
    expect(r).toMatchObject({ scored: 1, pending: 0, unscored: 0 })
    expect(r.byLetter.A).toEqual({ n: 1, netPoints: 40, ahead: 1, behind: 0, held: 1, decided: 1 })
  })

  it('F held up when its side was out-scored; C decides nothing; too recent is pending; no player in the feed is unscored', () => {
    const recent = new Date(NOW.getTime() - (SPORT_LEDGER_MIN_DAYS - 1) * DAY).toISOString()
    const r = gradeSportTradeRows('NBA', [
      row('F', '2026-11-01T18:00:00Z', ['x'], ['g']),
      row('C', '2026-11-01T18:00:00Z', ['g'], ['x']),
      row('A', recent, ['g'], ['x']),
      row('B', '2026-11-01T18:00:00Z', ['nobody'], ['x']),
    ], games, NOW)
    expect(r.byLetter.F).toMatchObject({ held: 1, decided: 1, behind: 1 })
    expect(r.byLetter.C).toMatchObject({ n: 1, decided: 0 })
    expect(r).toMatchObject({ pending: 1, unscored: 1, scored: 2 })
  })
})

describe('loadSportTradeLedger', () => {
  it('reads the sport\'s grades once per deal and its game points, and says how many ids it placed', async () => {
    const receipt = { grade: { graded: true, letter: 'B', leagueType: { type: 'redraft' } }, canonical: { proposerRosterId: 'r1', moves: [{ playerId: 'g', fromRosterId: 'r2', toRosterId: 'r1' }, { playerId: 'zz', fromRosterId: 'r1', toRosterId: 'r2' }] }, assets: [] }
    const calls: string[] = []
    const db = {
      $queryRaw: vi.fn(async (q: TemplateStringsArray, ...v: unknown[]) => {
        const sql = q.join('?')
        calls.push(sql)
        if (sql.includes('trade_decision_snapshots')) {
          expect(v).toContain('NBA')
          return [{ is_trade: true, surface: 'proposal', captured_at: new Date('2026-11-01T18:00:00Z'), receipt }]
        }
        if (sql.includes('PlayerIdentityMap')) return []
        return [{ pid: 'g', day: new Date('2026-11-03T00:00:00Z'), p: 44 }]
      }),
    }
    const out = await loadSportTradeLedger('NBA', { db: db as never, now: NOW })
    expect(calls[0]).toContain('DISTINCT ON')
    expect(out).toMatchObject({ read: 1, gradable: 1, idsTotal: 2, idsPlaced: 1 })
    // One side's player is not in the feed at all: unscored, never scored as zero.
    expect(out.result).toMatchObject({ scored: 0, unscored: 1 })
  })
})

describe('ids the feed does not know by name: through the identity map', () => {
  it('the one player carrying the id lends his other ids; an id two players carry is left out', () => {
    const identity = [
      { id: 'p1', ids: ['s-100', null, 'ri-9', 'api-4', null] },
      { id: 'p2', ids: ['s-200', null, 'ri-7', null, '777'] },
      { id: 'p3', ids: [null, null, 'ri-8', null, '777'] },
    ]
    const { aliases, ambiguous } = crosswalkAliases(['s-100', '777', 'nobody'], identity)
    expect(aliases.get('s-100')).toEqual(['ri-9', 'api-4'])
    expect(aliases.has('777')).toBe(false)
    expect(aliases.has('nobody')).toBe(false)
    expect(ambiguous).toBe(1)
  })

  it('a Sleeper-keyed receipt scores against a provider-keyed feed, and the result says how it was matched', async () => {
    const receipt = { grade: { graded: true, letter: 'A', leagueType: { type: 'redraft' } }, canonical: { proposerRosterId: 'r1', moves: [{ playerId: 's-100', fromRosterId: 'r2', toRosterId: 'r1' }, { playerId: 'g', fromRosterId: 'r1', toRosterId: 'r2' }] }, assets: [] }
    const db = {
      $queryRaw: vi.fn(async (q: TemplateStringsArray, ...v: unknown[]) => {
        const sql = q.join('?')
        if (sql.includes('trade_decision_snapshots')) return [{ is_trade: true, surface: 'proposal', captured_at: new Date('2026-11-01T18:00:00Z'), receipt }]
        if (sql.includes('PlayerIdentityMap')) {
          expect(JSON.stringify(v)).toContain('s-100')
          return [{ id: 'p1', ids: ['s-100', null, 'ri-9', null] }]
        }
        if (sql.includes('provider_player_id')) {
          expect(JSON.stringify(v)).toContain('ri-9')
          // The feed knows him by his provider id, on two days after the grade.
          return [{ pid: 'internal-1', ppid: 'ri-9', day: new Date('2026-11-03T00:00:00Z'), p: 30 }, { pid: 'internal-1', ppid: 'ri-9', day: new Date('2026-11-04T00:00:00Z'), p: 25 }]
        }
        return [{ pid: 'g', day: new Date('2026-11-03T00:00:00Z'), p: 44 }]
      }),
    }
    const out = await loadSportTradeLedger('NBA', { db: db as never, now: NOW })
    expect(out).toMatchObject({ idsTotal: 2, idsPlaced: 2, idsViaIdentity: 1, idsAmbiguous: 0 })
    expect(out.result).toMatchObject({ scored: 1, unscored: 0 })
    expect(out.result.byLetter.A).toMatchObject({ n: 1, netPoints: 11, ahead: 1, held: 1 })
  })
})
