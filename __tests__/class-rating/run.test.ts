// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FactRow } from '@/lib/class-rating/inputs'

const store = vi.hoisted(() => ({
  ready: true,
  state: null as null | { date: string; inputHash: string; computedAt: string },
  rows: [] as FactRow[],
  failReplace: false,
  replaced: [] as Array<{ ratings: number; events: number }>,
  stateWrites: [] as Array<{ date: string; inputHash: string }>,
}))

vi.mock('@/lib/class-rating/store', () => ({
  CLASS_SPORT: 'NFL',
  classTablesReady: vi.fn(async () => store.ready),
  readClassRatingState: vi.fn(async () => store.state),
  writeClassRatingState: vi.fn(async (s: { date: string; inputHash: string; computedAt: string }) => {
    store.stateWrites.push({ date: s.date, inputHash: s.inputHash })
    store.state = s
  }),
  loadFactRows: vi.fn(async () => store.rows),
  loadLeagueMeta: vi.fn(async (ids: string[]) => new Map(ids.map((id) => [id, { leagueId: id, season: 2025, settings: { current_week: 18 } }]))),
  replaceClassRatings: vi.fn(async (args: { classified: Map<string, unknown>; events: unknown[] }) => {
    if (store.failReplace) throw new Error('tx timed out')
    const out = { ratings: args.classified.size, events: args.events.length }
    store.replaced.push(out)
    return out
  }),
}))

import { MIN_BUDGET_MS, runClassRatingDaily } from '@/lib/class-rating/run'

const NOW = new Date('2026-10-01T16:00:00Z')
const people = ['a', 'b', 'c', 'd', 'e', 'f']
function season(): FactRow[] {
  const out: FactRow[] = []
  for (let week = 1; week <= 4; week++)
    for (let i = 0; i < people.length; i += 2)
      out.push({
        leagueId: 'L1',
        platform: 'sleeper',
        platformLeagueId: 'P1',
        season: 2025,
        week,
        userA: people[i],
        userB: people[i + 1],
        claimA: i === 0 ? 'af-user' : null,
        claimB: null,
        scoreA: 100 + i,
        scoreB: 101 + i,
        winnerTeamId: 'x',
      })
  return out
}

beforeEach(() => {
  store.ready = true
  store.state = null
  store.rows = season()
  store.failReplace = false
  store.replaced = []
  store.stateWrites = []
  vi.unstubAllEnvs()
})

describe('runClassRatingDaily', () => {
  it('rebuilds on a new input, then records the day and the hash LAST', async () => {
    const out = await runClassRatingDaily(NOW)
    expect(out).toMatchObject({ date: '2026-10-01', skipped: null, rebuilt: 1, games: 12, people: 6, events: 24, failed: 0 })
    expect(store.replaced).toEqual([{ ratings: 6, events: 24 }])
    expect(store.stateWrites).toHaveLength(1)
    expect(store.stateWrites[0].date).toBe('2026-10-01')
  })

  it('does nothing more on a second fire the same Eastern day', async () => {
    await runClassRatingDaily(NOW)
    const again = await runClassRatingDaily(new Date('2026-10-02T03:00:00Z')) // still Oct 1 in New York
    expect(again.skipped).toBe('already_ran_today')
    expect(store.replaced).toHaveLength(1)
  })

  it('skips the rebuild when tomorrow’s input hashes the same, but still marks the day', async () => {
    await runClassRatingDaily(NOW)
    const next = await runClassRatingDaily(new Date('2026-10-02T16:00:00Z'))
    expect(next).toMatchObject({ skipped: 'unchanged_input', rebuilt: 0 })
    expect(store.replaced).toHaveLength(1)
    expect(store.state?.date).toBe('2026-10-02')
  })

  it('rebuilds when a score changes', async () => {
    await runClassRatingDaily(NOW)
    store.rows[0].scoreA += 1
    const next = await runClassRatingDaily(new Date('2026-10-02T16:00:00Z'))
    expect(next.rebuilt).toBe(1)
    expect(store.replaced).toHaveLength(2)
  })

  it('🛑 a failed write is counted, not thrown, and leaves the OLD hash so the next fire retries', async () => {
    store.failReplace = true
    const out = await runClassRatingDaily(NOW)
    expect(out).toMatchObject({ failed: 1, rebuilt: 0 })
    expect(out.errors[0]).toMatch(/tx timed out/)
    expect(store.stateWrites).toHaveLength(0)
  })

  it('stands down for the next fire when too little budget is left', async () => {
    const out = await runClassRatingDaily(NOW, { remainingMs: () => MIN_BUDGET_MS - 1 })
    expect(out.skipped).toBe('no_time')
    expect(store.replaced).toHaveLength(0)
  })

  it('reads a missing table as "nothing to do", and honours the kill switch', async () => {
    store.ready = false
    expect((await runClassRatingDaily(NOW)).skipped).toBe('tables_missing')
    vi.stubEnv('CLASS_RATING_DISABLED', 'true')
    expect((await runClassRatingDaily(NOW)).skipped).toBe('disabled')
  })
})
