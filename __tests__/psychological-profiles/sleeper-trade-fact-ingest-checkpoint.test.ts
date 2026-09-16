/**
 * The scheduled Sleeper trade ingest, and the two things that stop it re-reading finished history.
 *
 * ── WHY THESE ASSERTIONS AND NOT "IT WROTE SOME ROWS" ────────────────────────────────────────
 *
 * Every failure this change could introduce is silent. A season skipped that should not have
 * been loses trades with nothing going red. A week mislabelled by an off-by-one stamps rows with
 * the wrong `weekOrPeriod` and reads as data. A skip counted as a dead feed reports a healthy
 * league as broken. None of those throw, so each is pinned by URL and by row content rather than
 * by a count.
 *
 * ⚠ THE FETCH SPY IS THE POINT. The saving IS the requests not made, so the assertion has to be
 * about which URLs were called — a test that only checked the written rows would pass unchanged
 * with the whole checkpoint deleted.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  leagueFindMany: vi.fn(),
  factFindFirst: vi.fn(),
  factUpsert: vi.fn(),
  getNflState: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findMany: h.leagueFindMany },
    transactionFact: { findFirst: h.factFindFirst, upsert: h.factUpsert },
  },
}))
vi.mock('@/lib/sleeper-client', () => ({ getNflState: h.getNflState }))
// Keeps the sweep quick: the real helpers sleep between provider calls.
vi.mock('@/lib/async-utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/async-utils')>()),
  jitterSleep: vi.fn(async () => {}),
  sleep: vi.fn(async () => {}),
}))

import { ingestSleeperTradeFacts } from '@/lib/psychological-profiles/SleeperTradeFactIngest'

const TRADE = {
  transaction_id: 'tx-1',
  type: 'trade',
  status: 'complete',
  roster_ids: [1, 2],
  adds: { '4034': 1 },
  drops: { '4034': 2 },
  draft_picks: [],
}

/** `/league/<id>` for a season, and `/league/<id>/transactions/<week>` for its weeks. */
type Chain = Record<string, { season: string; status: string; previous_league_id: string | null }>

function installFetch(chain: Chain, tradesAtWeek: Record<string, number[]> = {}) {
  const calls: string[] = []
  const spy = vi.fn(async (url: string) => {
    calls.push(url)
    const txMatch = /\/league\/([^/]+)\/transactions\/(\d+)$/.exec(url)
    if (txMatch) {
      const [, id, week] = txMatch
      const body = (tradesAtWeek[id] ?? []).includes(Number(week)) ? [TRADE] : []
      return { ok: true, status: 200, headers: new Headers(), json: async () => body }
    }
    const leagueMatch = /\/league\/([^/]+)$/.exec(url)
    if (leagueMatch && chain[leagueMatch[1]]) {
      const link = chain[leagueMatch[1]]
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ league_id: leagueMatch[1], ...link }),
      }
    }
    return { ok: false, status: 404, headers: new Headers(), json: async () => null }
  })
  vi.stubGlobal('fetch', spy)
  return { calls }
}

const weeksFetchedFor = (calls: string[], leagueId: string) =>
  calls
    .map((u) => new RegExp(`/league/${leagueId}/transactions/(\\d+)$`).exec(u)?.[1])
    .filter((w): w is string => Boolean(w))
    .map(Number)
    .sort((a, b) => a - b)

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  h.leagueFindMany.mockResolvedValue([
    { id: 'af-league', platformLeagueId: 'S-2026', sport: 'NFL', season: 2026 },
  ])
  h.factUpsert.mockResolvedValue({})
  h.factFindFirst.mockResolvedValue(null)
  h.getNflState.mockResolvedValue({ week: 12 })
})

describe('the completion gate — a finished season is not re-read', () => {
  const chain: Chain = {
    'S-2026': { season: '2026', status: 'in_season', previous_league_id: 'S-2025' },
    'S-2025': { season: '2025', status: 'complete', previous_league_id: null },
  }

  it('skips a finished season we already hold, and still walks the live one', async () => {
    h.factFindFirst.mockResolvedValue({ transactionId: 'tx-old:1' })
    const { calls } = installFetch(chain)

    const result = await ingestSleeperTradeFacts({ leagueIds: ['af-league'] })

    expect(weeksFetchedFor(calls, 'S-2025')).toEqual([])
    expect(result.seasonsSkippedComplete).toBe(1)
    expect(result.seasonsConsidered).toBe(2)
    // The live season is still read — narrowed, not skipped.
    expect(weeksFetchedFor(calls, 'S-2026').length).toBeGreaterThan(0)
  })

  /**
   * 🛑 THE POSITIVE CONTROL FOR THE ASSERTION ABOVE. An empty week list is what a broken fetch
   * spy produces too, so the same check has to be shown going the other way on the one input
   * that must NOT be skipped: a finished season nobody has read yet is exactly the history this
   * ingest exists to collect.
   */
  it('does NOT skip a finished season when no rows exist for it yet', async () => {
    h.factFindFirst.mockResolvedValue(null)
    const { calls } = installFetch(chain)

    const result = await ingestSleeperTradeFacts({ leagueIds: ['af-league'] })

    expect(weeksFetchedFor(calls, 'S-2025')).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18,
    ])
    expect(result.seasonsSkippedComplete).toBe(0)
  })

  it('treats an unreported status as not complete, so an unknown never narrows', async () => {
    h.factFindFirst.mockResolvedValue({ transactionId: 'tx-old:1' })
    const { calls } = installFetch({
      'S-2026': { season: '2026', status: 'in_season', previous_league_id: 'S-2024' },
      // No `status` at all — a provider that does not report one.
      'S-2024': { season: '2024', status: undefined as unknown as string, previous_league_id: null },
    })

    const result = await ingestSleeperTradeFacts({ leagueIds: ['af-league'] })

    expect(result.seasonsSkippedComplete).toBe(0)
    expect(weeksFetchedFor(calls, 'S-2024').length).toBeGreaterThan(0)
  })

  it('force re-reads a finished season we already hold', async () => {
    h.factFindFirst.mockResolvedValue({ transactionId: 'tx-old:1' })
    const { calls } = installFetch(chain)

    const result = await ingestSleeperTradeFacts({ leagueIds: ['af-league'], force: true })

    expect(result.seasonsSkippedComplete).toBe(0)
    expect(weeksFetchedFor(calls, 'S-2025').length).toBe(18)
  })
})

describe('the week checkpoint — the live season is read from near the current week', () => {
  const liveOnly: Chain = {
    'S-2026': { season: '2026', status: 'in_season', previous_league_id: null },
  }

  it('starts one week BEFORE the current week, so a backdated settlement is not lost', async () => {
    h.factFindFirst.mockResolvedValue({ transactionId: 'tx-old:1' })
    h.getNflState.mockResolvedValue({ week: 12 })
    const { calls } = installFetch(liveOnly)

    await ingestSleeperTradeFacts({ leagueIds: ['af-league'] })

    expect(weeksFetchedFor(calls, 'S-2026')).toEqual([11, 12, 13, 14, 15, 16, 17, 18])
  })

  it('walks every week on a first pass — there is nothing to be incremental about', async () => {
    h.factFindFirst.mockResolvedValue(null)
    const { calls } = installFetch(liveOnly)

    await ingestSleeperTradeFacts({ leagueIds: ['af-league'] })

    expect(weeksFetchedFor(calls, 'S-2026')[0]).toBe(1)
  })

  /**
   * 🛑 AN UNKNOWN WEEK WIDENS, NEVER NARROWS. `getNflState` failing is the absence of evidence
   * about what changed, not evidence that nothing did.
   */
  it('walks every week when the current week is unknown', async () => {
    h.factFindFirst.mockResolvedValue({ transactionId: 'tx-old:1' })
    h.getNflState.mockResolvedValue(null)
    const { calls } = installFetch(liveOnly)

    await ingestSleeperTradeFacts({ leagueIds: ['af-league'] })

    expect(weeksFetchedFor(calls, 'S-2026')[0]).toBe(1)
  })

  it('reads the NFL state at most once for the whole sweep', async () => {
    h.factFindFirst.mockResolvedValue({ transactionId: 'tx-old:1' })
    h.leagueFindMany.mockResolvedValue([
      { id: 'af-a', platformLeagueId: 'S-2026', sport: 'NFL', season: 2026 },
      { id: 'af-b', platformLeagueId: 'S-2026', sport: 'NFL', season: 2026 },
    ])
    installFetch(liveOnly)

    await ingestSleeperTradeFacts({ leagueIds: ['af-a', 'af-b'] })

    expect(h.getNflState).toHaveBeenCalledTimes(1)
  })
})

describe('what a narrowed window must not corrupt', () => {
  /**
   * 🛑 THE OFF-BY-ONE THIS CHANGE COULD HAVE SHIPPED. The results array is no longer indexed
   * from week 1, so a week derived from the array index would stamp every row of a checkpointed
   * run with the wrong `weekOrPeriod` — and a wrong week is indistinguishable from a real one to
   * every reader downstream.
   */
  it('stamps the real week on a row found inside a narrowed window', async () => {
    h.factFindFirst.mockResolvedValue({ transactionId: 'tx-old:1' })
    h.getNflState.mockResolvedValue({ week: 12 })
    installFetch(
      { 'S-2026': { season: '2026', status: 'in_season', previous_league_id: null } },
      { 'S-2026': [13] },
    )

    await ingestSleeperTradeFacts({ leagueIds: ['af-league'] })

    expect(h.factUpsert).toHaveBeenCalled()
    for (const call of h.factUpsert.mock.calls) {
      expect(call[0].create.weekOrPeriod).toBe(13)
    }
  })

  /**
   * 🛑 A SKIPPED SEASON IS NOT A DEAD FEED. `feedUnavailable` is set by reading no weeks, and a
   * league whose every season is finished and already held reads none — so the success of the
   * skip would report a healthy league as broken.
   */
  it('does not report a fully skipped league as an unavailable feed', async () => {
    h.factFindFirst.mockResolvedValue({ transactionId: 'tx-old:1' })
    installFetch({
      'S-2026': { season: '2026', status: 'complete', previous_league_id: null },
    })

    const result = await ingestSleeperTradeFacts({ leagueIds: ['af-league'] })

    expect(result.seasonsSkippedComplete).toBe(1)
    expect(result.feedUnavailable).toBe(0)
  })

  /**
   * The positive control for the assertion above: a genuinely dead feed must still be reported,
   * or the line just added would be a blanket suppression rather than a distinction.
   */
  it('still reports a genuinely dead feed', async () => {
    h.factFindFirst.mockResolvedValue(null)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        /\/transactions\//.test(url)
          ? { ok: false, status: 404, headers: new Headers(), json: async () => null }
          : {
              ok: true,
              status: 200,
              headers: new Headers(),
              json: async () => ({
                league_id: 'S-2026',
                season: '2026',
                status: 'in_season',
                previous_league_id: null,
              }),
            },
      ),
    )

    const result = await ingestSleeperTradeFacts({ leagueIds: ['af-league'] })

    expect(result.feedUnavailable).toBe(1)
  })
})
