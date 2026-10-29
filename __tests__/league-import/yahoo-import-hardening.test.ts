import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Yahoo import hardening — three defects that would have shipped the day Yahoo is switched on.
 *
 *   1. Sport gating. `provider-ui-config.ts` lists Yahoo as NFL-only, but discovery asks Yahoo for
 *      `game_keys=nfl,nba,mlb,nhl` and the pipeline imported whatever came back.
 *   2. A league whose sport could not be read was imported as NFL (`?? 'NFL'`).
 *   3. Transactions were one `count=100` request, never paged — a league with 101+ lost the rest.
 *
 * 🛑 NO YAHOO CONTRACT OR FIXTURE EXISTS, AND THIS REPO FORBIDS PROBING A VENDOR FOR A SHAPE.
 * Every Yahoo body below is SYNTHETIC, built to the parsers already in
 * `YahooLeagueFetchService.ts` (the `fantasy_content` → fragment-array layout they read), not
 * captured from Yahoo. `global.fetch` is stubbed throughout; nothing here reaches the network.
 */

vi.mock('@/lib/prisma', () => ({
  prisma: { playerIdentityMap: { findMany: vi.fn(async () => []) } },
}))

vi.mock('@/lib/yahoo/yahooCredentialStore', () => {
  class YahooImportConnectionError extends Error {}
  return {
    YahooImportConnectionError,
    loadYahooCredential: vi.fn(async (userId: string) => ({
      userId,
      accessToken: 'test-access-token',
      refreshToken: null,
    })),
    refreshYahooCredential: vi.fn(async () => 'test-access-token'),
  }
})

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `HTTP ${status}`,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

type LeagueMeta = {
  league_key: string
  league_id: string
  name: string
  season: string
  num_teams: number
  game_code?: string
  url?: string
}

/** Routes each Yahoo URL to a synthetic body. Records every URL asked for. */
function stubYahoo(meta: LeagueMeta, opts: { transactionPages?: unknown[] } = {}) {
  const urls: string[] = []
  const teamKey = `${meta.league_key}.t.1`
  global.fetch = vi.fn(async (input: unknown) => {
    const url = String(input)
    urls.push(url)
    if (url.includes('/users;use_login=1')) return jsonResponse({ fantasy_content: {} })
    if (/\/league\/[^/]+\/teams\?/.test(url)) {
      return jsonResponse({
        fantasy_content: {
          league: [{ league_key: meta.league_key }, { teams: { '0': { team: [[{ team_key: teamKey }, { name: 'Team One' }]] }, count: 1 } }],
        },
      })
    }
    if (/\/league\/[^/]+\/transactions;/.test(url)) {
      const start = Number(/;start=(\d+)/.exec(url)?.[1] ?? 0)
      const pages = opts.transactionPages ?? []
      const index = Math.floor(start / 100)
      return jsonResponse(pages[index] ?? { fantasy_content: { league: [{}, { transactions: { count: 0 } }] } })
    }
    if (url.includes(`/team/${teamKey}/roster`)) {
      return jsonResponse({ fantasy_content: { team: [[{ team_key: teamKey }], { roster: { players: { count: 0 } } }] } })
    }
    if (/\/league\/[^/;?]+\?format=json$/.test(url)) {
      return jsonResponse({ fantasy_content: { league: [meta] } })
    }
    return jsonResponse({ fantasy_content: {} })
  }) as unknown as typeof fetch
  return urls
}

/** A synthetic transactions page holding `n` add transactions with ids starting at `from`. */
function transactionsPage(from: number, n: number) {
  const transactions: Record<string, unknown> = { count: n }
  for (let i = 0; i < n; i++) {
    transactions[String(i)] = {
      transaction: [{ transaction_key: `tx-${from + i}`, type: 'add', status: 'successful', timestamp: '1760000000' }, { players: { count: 0 } }],
    }
  }
  return { fantasy_content: { league: [{}, { transactions }] } }
}

const realFetch = global.fetch

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  global.fetch = realFetch
})

describe('Yahoo import — sport gate (fix 1)', () => {
  it('refuses an NBA Yahoo league with a clear message, through the real fetch and adapter', async () => {
    stubYahoo({ league_key: 'nba.l.555', league_id: '555', name: 'Hoops', season: '2026', num_teams: 1, game_code: 'nba' })
    const { runImportedLeagueNormalizationPipeline } = await import('@/lib/league-import/ImportedLeagueNormalizationPipeline')

    const out = await runImportedLeagueNormalizationPipeline({ provider: 'yahoo', sourceId: 'nba.l.555', userId: 'u1' })

    expect(out.success).toBe(false)
    if (out.success) return
    expect(out.code).toBe('UNSUPPORTED_SPORT')
    expect(out.error).toBe(
      'Yahoo imports support NFL leagues right now — this league is NBA, so it was not imported. Nothing was saved.',
    )
  })

  it('still imports an NFL Yahoo league', async () => {
    stubYahoo({ league_key: '461.l.777', league_id: '777', name: 'Gridiron', season: '2026', num_teams: 1, game_code: 'nfl' })
    const { runImportedLeagueNormalizationPipeline } = await import('@/lib/league-import/ImportedLeagueNormalizationPipeline')

    const out = await runImportedLeagueNormalizationPipeline({ provider: 'yahoo', sourceId: '461.l.777', userId: 'u1' })

    expect(out.success).toBe(true)
    if (!out.success) return
    expect(out.normalized.league.sport).toBe('NFL')
    expect(out.normalized.league.name).toBe('Gridiron')
  })
})

describe('Yahoo import — a league with no sport is refused, not guessed (fix 2)', () => {
  /* Numeric game id, no game_code, no recognisable URL: nothing names the sport. */
  const noSport = { league_key: '461.l.888', league_id: '888', name: 'Mystery', season: '2026', num_teams: 1 }

  it('fetchYahooLeagueForImport throws instead of returning sport NFL', async () => {
    stubYahoo(noSport)
    const { fetchYahooLeagueForImport, YahooImportUnknownSportError } = await import(
      '@/lib/league-import/yahoo/YahooLeagueFetchService'
    )

    const err = await fetchYahooLeagueForImport('u1', '461.l.888').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(YahooImportUnknownSportError)
  })

  it('the pipeline reports it as UNSUPPORTED_SPORT, and no further Yahoo reads were made', async () => {
    const urls = stubYahoo(noSport)
    const { runImportedLeagueNormalizationPipeline } = await import('@/lib/league-import/ImportedLeagueNormalizationPipeline')

    const out = await runImportedLeagueNormalizationPipeline({ provider: 'yahoo', sourceId: '461.l.888', userId: 'u1' })

    expect(out.success).toBe(false)
    if (out.success) return
    expect(out.code).toBe('UNSUPPORTED_SPORT')
    expect(out.error).toMatch(/did not say which sport/)
    expect(urls.some((u) => u.includes('/settings?') || u.includes('/transactions;'))).toBe(false)
  })

  it('reads the sport from game_code, a code-form league key, or the URL — in that order', async () => {
    const { resolveYahooLeagueSport } = await import('@/lib/league-import/yahoo/YahooLeagueFetchService')
    expect(resolveYahooLeagueSport({ listedSport: 'nhl', leagueNode: { game_code: 'nfl' }, leagueKey: 'x' })).toBe('NHL')
    expect(resolveYahooLeagueSport({ listedSport: null, leagueNode: { game_code: 'mlb' }, leagueKey: '461.l.1' })).toBe('MLB')
    expect(resolveYahooLeagueSport({ listedSport: null, leagueNode: {}, leagueKey: 'nfl.l.1' })).toBe('NFL')
    expect(
      resolveYahooLeagueSport({ listedSport: null, leagueNode: { url: 'https://basketball.fantasysports.yahoo.com/nba/1' }, leagueKey: '466.l.1' }),
    ).toBe('NBA')
    expect(resolveYahooLeagueSport({ listedSport: null, leagueNode: {}, leagueKey: '461.l.1' })).toBeNull()
  })
})

describe('Yahoo transactions paging (fix 3)', () => {
  it('fetches 3 pages for 250 transactions and keeps all 250', async () => {
    const { fetchYahooTransactionPages } = await import('@/lib/league-import/yahoo/YahooLeagueFetchService')
    const calls: Array<[number, number]> = []
    const pages = [transactionsPage(0, 100), transactionsPage(100, 100), transactionsPage(200, 50)]

    const out = await fetchYahooTransactionPages(async (start, count) => {
      calls.push([start, count])
      return pages[start / 100]
    })

    expect(calls).toEqual([
      [0, 100],
      [100, 100],
      [200, 100],
    ])
    expect(out.pagesFetched).toBe(3)
    expect(out.transactions).toHaveLength(250)
    expect(out.truncatedAtBound).toBe(false)
    expect(out.stoppedOnError).toBe(false)
  })

  it('stops at the page bound even when every page is full', async () => {
    const { fetchYahooTransactionPages } = await import('@/lib/league-import/yahoo/YahooLeagueFetchService')
    let calls = 0
    const out = await fetchYahooTransactionPages(
      async (start) => {
        calls++
        return transactionsPage(start, 100)
      },
      { maxPages: 4 },
    )
    expect(calls).toBe(4)
    expect(out.pagesFetched).toBe(4)
    expect(out.transactions).toHaveLength(400)
    expect(out.truncatedAtBound).toBe(true)
  })

  it('has a default bound, so an endless full-page source cannot loop forever', async () => {
    const { fetchYahooTransactionPages, YAHOO_TRANSACTIONS_MAX_PAGES } = await import(
      '@/lib/league-import/yahoo/YahooLeagueFetchService'
    )
    let calls = 0
    const out = await fetchYahooTransactionPages(async (start) => {
      calls++
      return transactionsPage(start, 100)
    })
    expect(calls).toBe(YAHOO_TRANSACTIONS_MAX_PAGES)
    expect(out.truncatedAtBound).toBe(true)
  })

  it('keeps earlier pages when a later page fails, and propagates a first-page failure', async () => {
    const { fetchYahooTransactionPages } = await import('@/lib/league-import/yahoo/YahooLeagueFetchService')
    const partial = await fetchYahooTransactionPages(async (start) => {
      if (start >= 100) throw new Error('boom')
      return transactionsPage(0, 100)
    })
    expect(partial.transactions).toHaveLength(100)
    expect(partial.stoppedOnError).toBe(true)

    await expect(
      fetchYahooTransactionPages(async () => {
        throw new Error('first page down')
      }),
    ).rejects.toThrow('first page down')
  })

  it('de-duplicates a transaction that shifts across a page boundary', async () => {
    const { fetchYahooTransactionPages } = await import('@/lib/league-import/yahoo/YahooLeagueFetchService')
    /* tx-99 appears at the end of page 1 and again at the start of page 2. */
    const pages = [transactionsPage(0, 100), transactionsPage(99, 30)]
    const out = await fetchYahooTransactionPages(async (start) => pages[start / 100])
    expect(out.transactions).toHaveLength(129)
  })

  it('the import itself pages: 250 transactions arrive in the payload over start=0,100,200', async () => {
    const urls = stubYahoo(
      { league_key: '461.l.999', league_id: '999', name: 'Busy', season: '2026', num_teams: 1, game_code: 'nfl' },
      { transactionPages: [transactionsPage(0, 100), transactionsPage(100, 100), transactionsPage(200, 50)] },
    )
    const { fetchYahooLeagueForImport } = await import('@/lib/league-import/yahoo/YahooLeagueFetchService')

    const payload = await fetchYahooLeagueForImport('u1', '461.l.999')

    expect(payload.transactions).toHaveLength(250)
    const txUrls = urls.filter((u) => u.includes('/transactions;'))
    expect(txUrls).toHaveLength(3)
    expect(txUrls.map((u) => /;start=(\d+);count=(\d+)/.exec(u)?.slice(1).join('/'))).toEqual(['0/100', '100/100', '200/100'])
  })
})
