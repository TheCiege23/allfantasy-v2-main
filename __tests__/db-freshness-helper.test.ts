/**
 * The shared freshness helper — the one place that decides how row age is measured.
 *
 * WHY THIS IS TESTED WITH A FAKE CLIENT. The bug it prevents is invisible to CI: most freshness
 * columns are `timestamp without time zone` holding UTC, `pg` returns them as JS Dates in the
 * CLIENT's timezone, and `Date.now() - newest` is therefore correct on a UTC runner and wrong by
 * the local offset everywhere else. GitHub runners are UTC, so a behavioural test passes against
 * the broken arithmetic every single time.
 *
 * So these assert the MECHANISM: that the age comes out of Postgres, that the session is pinned,
 * and that "no rows" and "column is all NULL" stay distinguishable. A fake client makes the
 * emitted SQL and the returned shape both inspectable with no database.
 *
 * The bug was fixed once inline and then reintroduced the same day in a throwaway script that
 * printed -239m for heartbeats the monitor correctly showed as 1m. That is why the rule now lives
 * in a module instead of a comment.
 */
import { describe, it, expect, vi } from 'vitest'

import { maxAge, pinSessionToUtc, formatAge } from '../scripts/db-freshness.mjs'

/** Minimal pg-shaped stub: records the SQL it was handed, returns canned rows. */
function fakeClient(row: Record<string, unknown>) {
  const calls: Array<{ sql: string; params: unknown[] }> = []
  return {
    calls,
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params })
      return { rows: [row] }
    }),
  }
}

describe('pinSessionToUtc', () => {
  it('pins the session so naive and timestamptz columns behave the same', () => {
    const c = fakeClient({})
    pinSessionToUtc(c as never)
    expect(c.query).toHaveBeenCalledWith("SET TIME ZONE 'UTC'")
  })
})

describe('maxAge computes age in SQL, not in JS', () => {
  it('asks Postgres for the age against its own now()', async () => {
    const c = fakeClient({ newest: '2026-08-23T03:48:01.197Z', n: '10', n_ts: '10', age_seconds: '120' })
    await maxAge(c as never, { table: 'SportsInjury', column: 'fetchedAt' })

    const sql = c.calls[0].sql
    expect(sql).toContain('EXTRACT(EPOCH FROM (now() - max("fetchedAt")))')
    expect(sql).toContain('FROM "SportsInjury"')
  })

  it('returns the age Postgres reported, never one derived from the local clock', async () => {
    // 120s per the database. A UTC-4 client doing Date.now() - newest would produce roughly
    // -14,280,000ms here; anything other than exactly 120000 means the client clock leaked in.
    const c = fakeClient({ newest: '2026-08-23T03:48:01.197Z', n: '10', n_ts: '10', age_seconds: '120' })
    const out = await maxAge(c as never, { table: 't', column: 'c' })

    expect(out.ageMs).toBe(120_000)
    expect(out.ageMs).toBeGreaterThan(0)
  })

  it('never calls Date.now()', async () => {
    const spy = vi.spyOn(Date, 'now')
    const c = fakeClient({ newest: '2026-08-23T03:48:01.197Z', n: '1', n_ts: '1', age_seconds: '5' })
    await maxAge(c as never, { table: 't', column: 'c' })
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('maxAge keeps "no rows" and "column all NULL" distinguishable', () => {
  it('reports an empty table as zero rows with a null age', async () => {
    const c = fakeClient({ newest: null, n: '0', n_ts: '0', age_seconds: null })
    const out = await maxAge(c as never, { table: 't', column: 'c' })
    expect(out).toMatchObject({ rowCount: 0, timestampCount: 0, ageMs: null, newest: null })
  })

  it('reports rows-with-a-NULL-column distinctly — the wrong-column case', async () => {
    // player_game_stats: 252,768 rows, fetched_at NULL on every one. A bare max() reports this
    // identically to an empty table, and the two need opposite responses.
    const c = fakeClient({ newest: null, n: '252768', n_ts: '0', age_seconds: null })
    const out = await maxAge(c as never, { table: 'player_game_stats', column: 'fetched_at' })

    expect(out.rowCount).toBe(252_768)
    expect(out.timestampCount).toBe(0)
    expect(out.ageMs).toBeNull()
  })

  it('selects both counts so callers can tell them apart at all', async () => {
    const c = fakeClient({ newest: null, n: '0', n_ts: '0', age_seconds: null })
    await maxAge(c as never, { table: 't', column: 'c' })
    expect(c.calls[0].sql).toContain('count(*)')
    expect(c.calls[0].sql).toContain('count("c")')
  })
})

describe('maxAge parameterises the filter', () => {
  it('passes a where clause and its params through positionally', async () => {
    const c = fakeClient({ newest: null, n: '0', n_ts: '0', age_seconds: null })
    await maxAge(c as never, {
      table: 'sync_job_runs',
      column: 'started_at',
      where: '"job_name" = $1',
      params: ['cron-waivers'],
    })

    expect(c.calls[0].sql).toContain('WHERE "job_name" = $1')
    expect(c.calls[0].params).toEqual(['cron-waivers'])
  })

  it('omits WHERE entirely when no filter is given', async () => {
    const c = fakeClient({ newest: null, n: '0', n_ts: '0', age_seconds: null })
    await maxAge(c as never, { table: 't', column: 'c' })
    expect(c.calls[0].sql).not.toContain('WHERE')
  })
})

describe('formatAge', () => {
  it.each([
    [null, 'never'],
    [60_000, '1m'],
    [3 * 3_600_000, '3.0h'],
    [72 * 3_600_000, '3.0d'],
  ])('%s -> %s', (ms, expected) => {
    expect(formatAge(ms as number | null)).toBe(expected)
  })
})
