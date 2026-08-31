/**
 * The /core "Sync now" loop and its candidate selection.
 *
 * ⚠ WHY THIS FILE EXISTS AT ALL. `runSyncRounds` is the only part of the sync
 * feature that can do UNBOUNDED work against live vendor APIs — it posts, reads
 * `remaining`, and posts again on a user's behalf. A termination bug there is
 * not a rendering glitch, it is an open-ended stream of provider calls. The rest
 * of the feature fails safe; this does not, so it is the part that gets executed
 * by a test rather than reasoned about.
 *
 * ⚠ NOTHING HERE TOUCHES A PROVIDER, A DATABASE OR A BROWSER. Rounds are
 * fabricated objects and `post` is injected. A test for a loop that calls real
 * vendors would be the very thing the loop is dangerous for.
 *
 * ⚠ `__tests__` IS EXCLUDED FROM tsconfig, so a green typecheck says nothing
 * about this file. `vitest run` is the only thing that reads it — which is
 * precisely why the positive-control test at the bottom is not optional.
 */

import { describe, expect, it, vi } from 'vitest'

import { runSyncRounds, MAX_ROUNDS, type SyncPostResult } from '@/lib/core-app/syncRunLoop'
import { selectResyncCandidates } from '@/lib/core-app/resyncableLeagues'

/** A round the server would send. Defaults describe a clean, finished run. */
function round(over: Partial<{
  ok: boolean
  totalCandidates: number
  attempted: number
  synced: number
  locked: number
  failed: number
  remaining: string[]
  error: string
}> = {}): SyncPostResult {
  return {
    httpOk: true,
    round: {
      ok: true,
      totalCandidates: 1,
      attempted: 1,
      synced: 1,
      locked: 0,
      failed: 0,
      remaining: [],
      ...over,
    },
  }
}

/** Feeds the given rounds in order, then fails loudly rather than looping forever. */
function scriptedPost(results: SyncPostResult[]) {
  let i = 0
  return vi.fn(async () => {
    if (i >= results.length) throw new Error('loop asked for more rounds than the script provides')
    return results[i++]!
  })
}

describe('runSyncRounds — termination', () => {
  it('stops when remaining empties, and reports a clean success', async () => {
    const post = scriptedPost([round({ totalCandidates: 2, synced: 2 })])
    const out = await runSyncRounds({ post })

    expect(post).toHaveBeenCalledTimes(1)
    expect(out.status).toBe('done')
    expect(out.tone).toBe('ok')
    expect(out.exhausted).toBe(false)
    expect(out.message).toBe('Synced 2')
  })

  it('continues across rounds and posts the previous remaining back', async () => {
    const post = scriptedPost([
      round({ totalCandidates: 3, attempted: 2, synced: 2, remaining: ['sleeper:c'] }),
      round({ totalCandidates: 3, attempted: 1, synced: 1, remaining: [] }),
    ])
    const out = await runSyncRounds({ post })

    expect(post).toHaveBeenCalledTimes(2)
    /* First round asks for everything (null), the second names what was left. */
    expect(post.mock.calls[0]![0]).toBeNull()
    expect(post.mock.calls[1]![0]).toEqual(['sleeper:c'])
    expect(out.status).toBe('done')
    expect(out.synced).toBe(3)
    /* The denominator is fixed by round 1 and does not drift. */
    expect(out.total).toBe(3)
  })

  it('stops when a round attempts nothing, rather than spinning on it', async () => {
    /*
     * The dangerous shape: the server keeps saying work is left but never does
     * any. Without stop 2 this posts forever.
     */
    const post = scriptedPost([
      round({ totalCandidates: 5, attempted: 0, synced: 0, remaining: ['sleeper:a', 'sleeper:b'] }),
    ])
    const out = await runSyncRounds({ post })

    expect(post).toHaveBeenCalledTimes(1)
    expect(out.exhausted).toBe(true)
    expect(out.status).toBe('incomplete')
  })

  it('stops at maxRounds when the server never stops handing back work', async () => {
    /* Same never-finishing server, but attempting work each time, so only the
       backstop can end it. Unlimited script: the cap is what must stop this. */
    const post = vi.fn(async (): Promise<SyncPostResult> =>
      round({ totalCandidates: 99, attempted: 1, synced: 1, remaining: ['sleeper:x'] }),
    )
    const out = await runSyncRounds({ post, maxRounds: 4 })

    expect(post).toHaveBeenCalledTimes(4)
    expect(out.exhausted).toBe(true)
    expect(out.rounds).toBe(4)
  })

  it('reports the backstop as incomplete and invites another press — never as success', async () => {
    const post = vi.fn(async (): Promise<SyncPostResult> =>
      round({ totalCandidates: 99, attempted: 1, synced: 1, remaining: ['sleeper:x'] }),
    )
    const out = await runSyncRounds({ post, maxRounds: 3 })

    expect(out.status).toBe('incomplete')
    expect(out.tone).toBe('attention')
    expect(out.message).toBe('Synced 3 of 99 — press again to finish')
    /* The whole point: it must not read as a finished sync. */
    expect(out.message).not.toMatch(/^Synced \d+$/)
    expect(out.tone).not.toBe('ok')
  })

  it('ships a backstop that cannot end a normal run', () => {
    /* If MAX_ROUNDS were small it would silently become the terminator. */
    expect(MAX_ROUNDS).toBeGreaterThanOrEqual(40)
  })
})

describe('runSyncRounds — honest outcomes', () => {
  it('does not render a locked or failed league as a clean success', async () => {
    const post = scriptedPost([
      round({ totalCandidates: 3, attempted: 3, synced: 1, locked: 1, failed: 1 }),
    ])
    const out = await runSyncRounds({ post })

    expect(out.status).toBe('partial')
    expect(out.tone).toBe('attention')
    expect(out.message).toBe('Synced 1 of 3')
  })

  it('keeps partial progress visible when a later round dies', async () => {
    const post = scriptedPost([
      round({ totalCandidates: 4, attempted: 2, synced: 2, remaining: ['sleeper:c'] }),
      { httpOk: false, round: null },
    ])
    const out = await runSyncRounds({ post })

    expect(out.status).toBe('failed')
    expect(out.message).toBe('Stopped after 2 of 4')
  })

  it('surfaces the server error when nothing synced at all', async () => {
    const post = scriptedPost([
      { httpOk: false, round: { ok: false, error: 'We could not read your leagues just now.' } },
    ])
    const out = await runSyncRounds({ post })

    expect(out.status).toBe('failed')
    expect(out.message).toBe('We could not read your leagues just now.')
  })

  it('treats an empty account as ok, not as a failure', async () => {
    const post = scriptedPost([round({ totalCandidates: 0, attempted: 0, synced: 0 })])
    const out = await runSyncRounds({ post })

    expect(out.status).toBe('empty')
    expect(out.tone).toBe('ok')
  })
})

describe('selectResyncCandidates', () => {
  const sleeper = {
    id: 'l1',
    name: 'Dynasty',
    platform: 'sleeper',
    platformLeagueId: '123',
    navigationLeagueId: 'nav1',
    hasUnifiedRecord: true,
  }

  it('accepts a connected league with a native backing', () => {
    expect(selectResyncCandidates([sleeper]).map((c) => c.key)).toEqual(['sleeper:123'])
  })

  it('excludes a career-board snapshot, which has no live native backing', () => {
    /*
     * The exclusion that matters most: this row HAS a platformLeagueId, so a
     * looser test would sync it — and syncing it materializes a native league
     * out of what the user sees as read-only history.
     */
    const snapshot = { ...sleeper, navigationLeagueId: null, hasUnifiedRecord: false }
    expect(selectResyncCandidates([snapshot])).toEqual([])
  })

  it('excludes a league with no external id to re-read', () => {
    expect(selectResyncCandidates([{ ...sleeper, platformLeagueId: null }])).toEqual([])
  })

  it('excludes an unavailable provider', () => {
    /* Yahoo is registered but cannot complete an import, so it would fail every press. */
    expect(selectResyncCandidates([{ ...sleeper, platform: 'yahoo' }])).toEqual([])
  })

  it('excludes a native league, which has no provider to re-read from', () => {
    expect(selectResyncCandidates([{ ...sleeper, platform: 'allfantasy' }])).toEqual([])
  })

  it('deduplicates one external league appearing under two rows', () => {
    const out = selectResyncCandidates([sleeper, { ...sleeper, id: 'l2', navigationLeagueId: 'nav2' }])
    expect(out).toHaveLength(1)
  })
})

/*
 * ⚠ POSITIVE CONTROL. Everything above is a null-ish assertion about a loop that
 * stops; a suite of those passes just as happily if the code under test is never
 * reached. These prove the harness can go RED — that the import resolves to the
 * real module and that a wrong answer is actually caught.
 */
describe('positive control — these tests can fail', () => {
  it('catches a loop that does not terminate where it should', async () => {
    const post = vi.fn(async (): Promise<SyncPostResult> =>
      round({ totalCandidates: 9, attempted: 1, synced: 1, remaining: ['sleeper:x'] }),
    )
    const out = await runSyncRounds({ post, maxRounds: 5 })

    /* The real code stops at 5. Asserting it ran 6 MUST fail — if this passed,
       the assertion machinery is not measuring what we think it is. */
    expect(() => expect(post).toHaveBeenCalledTimes(6)).toThrow()
    expect(out.rounds).toBe(5)
  })

  it('catches a selector that wrongly admits a career-board snapshot', () => {
    const snapshot = {
      id: 'l1',
      platform: 'sleeper',
      platformLeagueId: '123',
      navigationLeagueId: null,
      hasUnifiedRecord: false,
    }
    /* Asserting the wrong behaviour must throw. A selector that admitted this
       row would make the assertion below pass and this test fail — which is
       exactly the alarm we want. */
    expect(() => expect(selectResyncCandidates([snapshot])).toHaveLength(1)).toThrow()
  })
})
