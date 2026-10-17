/**
 * The finder's value-trend card: the change and mover rules, the per-book loader, and the card.
 */
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

type Book = { source: 'FANTASYCALC'; format: 'DYNASTY' | 'REDRAFT'; qbFormat: 'ONE_QB' | 'SUPERFLEX' }
const DSF: Book = { source: 'FANTASYCALC', format: 'DYNASTY', qbFormat: 'SUPERFLEX' }
const R1: Book = { source: 'FANTASYCALC', format: 'REDRAFT', qbFormat: 'ONE_QB' }

const h = vi.hoisted(() => ({
  leagues: [] as Array<{ id: string; settings: { book: unknown }; leagueType: string | null }>,
  history: new Map<string, Array<{ day: string; value: number }>>(),
  dist: [] as number[],
  queryRaw: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => h.leagues.filter((l) => where.id.in.includes(l.id))) },
    $queryRaw: h.queryRaw,
  },
}))
vi.mock('@/lib/core-app/valueBook', () => ({
  CROSS_LEAGUE_BOOK: { source: 'FANTASYCALC', format: 'DYNASTY', qbFormat: 'SUPERFLEX' },
  valueBookFor: (settings: { book: unknown }) => settings.book,
  describeValueBook: (b: Book) => `${b.format.toLowerCase()} · ${b.qbFormat === 'SUPERFLEX' ? 'superflex' : '1QB'}`,
}))
vi.mock('@/lib/player-values/playerValueHistory', () => ({
  loadPlayerValueHistory: vi.fn(async ({ sleeperIds, book }: { sleeperIds: string[]; book: Book }) =>
    (h.history.get(`${book.format}:${book.qbFormat}`) ?? []).map((p) => ({ sleeperId: sleeperIds[0], ...p })),
  ),
}))

import {
  BIG_MOVE_SHARE,
  MIN_BOOK_PLAYERS,
  changeOver,
  consecutiveRuns,
  moverShareOf,
  nudgeFor,
  type BookTrend,
} from '@/lib/core-app/valueTrend'
import { clearValueTrendCache, loadValueTrend } from '@/lib/core-app/valueTrendLoader'
import { ValueTrend } from '@/components/core-app/player-finder/ValueTrend'

/** Daily points from `start` (YYYY-MM-DD), skipping any day in `skip`. */
function series(start: string, values: number[], skip: number[] = []) {
  const t0 = Date.parse(`${start}T00:00:00Z`)
  return values.flatMap((v, i) => (skip.includes(i) ? [] : [{ day: new Date(t0 + i * 86_400_000).toISOString().slice(0, 10), value: v }]))
}
const flatDist = (n = 100) => Array.from({ length: n }, (_, i) => i / 1000) // 0 .. 0.099

describe('value trend rules (pure)', () => {
  it('changes from the latest capture at least N days back, and has none when no capture reaches back that far', () => {
    const pts = series('2026-09-01', [100, 100, 100, 110, 120, 130, 140, 150, 160])
    expect(changeOver(pts, 7)).toEqual({ pct: 0.6, from: 100, fromDay: '2026-09-02' })
    expect(changeOver(series('2026-09-20', [100, 110, 120]), 7)).toBeNull()
    expect(changeOver(series('2026-09-01', [0, 1, 1, 1, 1, 1, 1, 1, 5]), 8)).toBeNull()
  })

  it('a gap moves the base to the capture before it, never interpolates', () => {
    // Day index 1 (Sep 2) is missing, so the base for Sep 9 is Sep 1.
    const pts = series('2026-09-01', [100, 999, 100, 100, 100, 100, 100, 100, 150], [1])
    expect(changeOver(pts, 7)).toMatchObject({ from: 100, fromDay: '2026-09-01', pct: 0.5 })
    expect(consecutiveRuns(pts).map((r) => r.length)).toEqual([1, 7])
  })

  it('ranks his move against the book, and refuses with too few players', () => {
    expect(moverShareOf(0.05, flatDist())).toBe(0.5)
    expect(moverShareOf(0.5, flatDist())).toBe(1)
    expect(moverShareOf(0.5, flatDist(MIN_BOOK_PLAYERS - 1))).toBeNull()
  })

  const book = (over: Partial<BookTrend>): BookTrend => ({
    book: DSF, label: 'dynasty · superflex', points: [], value: 5000, lastDay: '2026-09-28',
    change7: { pct: 0.2, from: 4167, fromDay: '2026-09-21' }, change30: null, moverShare: 0.9, leagues: 3, yours: 2, ...over,
  })

  it('sell-high when he is yours and jumped; check the cause when yours and dropped; buy-low when not yours and dropped', () => {
    expect(nudgeFor([book({})])).toMatchObject({ kind: 'sell-high', text: expect.stringContaining('You hold him in 2 leagues') })
    expect(nudgeFor([book({ change7: { pct: -0.2, from: 1, fromDay: 'x' } })])!.kind).toBe('check-cause')
    expect(nudgeFor([book({ change7: { pct: -0.2, from: 1, fromDay: 'x' }, yours: 0 })])!.kind).toBe('buy-low')
    expect(nudgeFor([book({ yours: 0 })])).toBeNull() // rising and not yours: no call to make
    expect(nudgeFor([book({ change7: { pct: 0.2, from: 1, fromDay: 'x' } })])!.text).toContain('than 9 in 10 players')
  })

  it(`no nudge for an ordinary move, a cheap player, or no week of history`, () => {
    expect(nudgeFor([book({ moverShare: BIG_MOVE_SHARE - 0.01 })])).toBeNull()
    expect(nudgeFor([book({ value: 900 })])).toBeNull()
    expect(nudgeFor([book({ change7: null })])).toBeNull()
  })

  it('reads the nudge from the book where he is yours most', () => {
    const redraft = book({ book: R1, label: 'redraft · 1QB', yours: 3, leagues: 3, change7: { pct: -0.3, from: 1, fromDay: 'x' } })
    const dynasty = book({ yours: 1, leagues: 5 })
    expect(nudgeFor([dynasty, redraft])).toMatchObject({ kind: 'check-cause', bookLabel: 'redraft · 1QB' })
  })
})

describe('loadValueTrend', () => {
  const NOW = new Date('2026-09-28T12:00:00Z')
  beforeEach(() => {
    vi.clearAllMocks()
    clearValueTrendCache()
    h.leagues = [
      { id: 'L1', settings: { book: DSF }, leagueType: 'dynasty' },
      { id: 'L2', settings: { book: DSF }, leagueType: 'dynasty' },
      { id: 'L3', settings: { book: R1 }, leagueType: 'redraft' },
    ]
    h.history = new Map([
      ['DYNASTY:SUPERFLEX', series('2026-08-29', [...Array(23).fill(5000), 5000, 5200, 5400, 5600, 5800, 6000, 6000, 6000])],
      ['REDRAFT:ONE_QB', series('2026-09-20', [2000, 2100, 2050, 2000, 1900, 1800, 1700, 1700, 1650])],
    ])
    h.dist = flatDist()
    h.queryRaw.mockImplementation(async () => h.dist.map((move) => ({ move })))
  })
  const load = (over: Partial<Parameters<typeof loadValueTrend>[0]> = {}) =>
    loadValueTrend({ sleeperId: '8138', leagueIds: ['L1', 'L2', 'L3'], yourLeagueIds: ['L1'], includeNudge: true, now: NOW, ...over })

  it('one row per book your leagues use, counted, yours first', async () => {
    const v = await load()
    expect(v!.books.map((b) => [b.label, b.leagues, b.yours])).toEqual([
      ['dynasty · superflex', 2, 1],
      ['redraft · 1QB', 1, 0],
    ])
    expect(v!.books[0]).toMatchObject({ value: 6000, lastDay: '2026-09-28' })
    expect(v!.books[0].change7!.pct).toBeCloseTo(0.2, 5) // 5000 on Sep 21 → 6000
  })

  it('signed out: the labelled default chart', async () => {
    const v = await load({ leagueIds: [], yourLeagueIds: [] })
    expect(v!.books.map((b) => [b.label, b.leagues])).toEqual([['dynasty · superflex', 0]])
  })

  it('a book with no history is dropped; no history anywhere is no card', async () => {
    h.history.delete('REDRAFT:ONE_QB')
    expect((await load())!.books).toHaveLength(1)
    h.history.clear()
    expect(await load()).toBeNull()
    expect(await load({ sleeperId: null })).toBeNull()
  })

  it('a big move on your book is a sell-high call for AF Pro, and a lock for everyone else', async () => {
    const open = await load()
    expect(open!.nudge).toMatchObject({ kind: 'sell-high', bookLabel: 'dynasty · superflex' })
    expect(open!.nudgeLocked).toBe(false)
    const locked = await load({ includeNudge: false })
    expect(locked!.nudge).toBeNull()
    expect(locked!.nudgeLocked).toBe(true)
    expect(locked!.books[0].change7).not.toBeNull() // the trend itself stays free
  })

  it('an ordinary move against the book produces no call and no lock', async () => {
    h.dist = Array.from({ length: 100 }, () => 0.5) // everyone moved more than he did
    const v = await load({ includeNudge: false })
    expect(v!.nudge).toBeNull()
    expect(v!.nudgeLocked).toBe(false)
  })

  it('a failed distribution read is not cached as "nobody moved"', async () => {
    // One book, so the rejected read is unambiguously this book's.
    h.queryRaw.mockRejectedValueOnce(new Error('db down'))
    expect((await load({ leagueIds: ['L1'] }))!.books[0].moverShare).toBeNull()
    expect((await load({ leagueIds: ['L1'] }))!.books[0].moverShare).not.toBeNull()
  })
})

describe('ValueTrend card', () => {
  const access = { depth: 'player_depth', unlocked: false, label: 'Player depth', planName: 'AF Pro', preLaunchFree: false, startsAt: '2026-10-15T00:00:00.000Z' } as never
  const NOW = new Date('2026-09-28T12:00:00Z')
  beforeEach(() => {
    clearValueTrendCache()
    h.leagues = [{ id: 'L1', settings: { book: DSF }, leagueType: 'dynasty' }]
    h.history = new Map([['DYNASTY:SUPERFLEX', series('2026-08-29', [...Array(23).fill(5000), 5000, 5200, 5400, 5600, 5800, 6000, 6000, 6000], [10])]])
    h.dist = flatDist()
    h.queryRaw.mockImplementation(async () => h.dist.map((move) => ({ move })))
  })

  it('shows the value, the book, the changes, a gapped sparkline and the call', async () => {
    const v = await loadValueTrend({ sleeperId: '8138', leagueIds: ['L1'], yourLeagueIds: ['L1'], includeNudge: true, now: NOW })
    const { container } = render(<ValueTrend data={v} access={null} />)
    expect(screen.getByRole('heading', { name: 'Market value, last 30 days' })).toBeTruthy()
    expect(screen.getByText('dynasty · superflex')).toBeTruthy()
    expect(screen.getByText('6,000')).toBeTruthy()
    expect(screen.getByText('7 days: +20%')).toBeTruthy()
    expect(screen.getByText(/^since Aug 3[01]: \+20%$/)).toBeTruthy()
    expect(container.querySelectorAll('polyline')).toHaveLength(2) // the missed day breaks the line
    expect(screen.getByText('Sell-high window')).toBeTruthy()
  })

  it('locked: the trend, and the lock where the call would be', async () => {
    const v = await loadValueTrend({ sleeperId: '8138', leagueIds: ['L1'], yourLeagueIds: ['L1'], includeNudge: false, now: NOW })
    render(<ValueTrend data={v} access={access} />)
    expect(screen.getByText('7 days: +20%')).toBeTruthy()
    expect(screen.queryByText('Sell-high window')).toBeNull()
    expect(screen.getByTestId('core-lock-player_depth')).toBeTruthy()
  })

  it('says so when there is not a week of history', () => {
    const t: BookTrend = { book: DSF, label: 'dynasty · superflex', points: series('2026-09-26', [100, 110, 120]), value: 120, lastDay: '2026-09-28', change7: null, change30: null, moverShare: null, leagues: 1, yours: 0 }
    render(<ValueTrend data={{ books: [t], nudge: null, nudgeLocked: false }} access={null} />)
    expect(screen.getByText('7 days: not enough history')).toBeTruthy()
  })
})
