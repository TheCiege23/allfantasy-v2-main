// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

/**
 * The browser connector's Transaction History sync: the extension may fetch ONLY the captured download
 * (contracts/fantrax/fixtures/2026-transaction-history-download.json), must refuse anything that is not the
 * export it asked for, and the API passes the two files to the importers for a signed-in commissioner.
 */
const mocks = vi.hoisted(() => ({ auth: vi.fn(), context: vi.fn(), importScores: vi.fn(), txContext: vi.fn(), txImport: vi.fn() }))
vi.mock('@/lib/auth-guard', () => ({ requireVerifiedUser: mocks.auth, requireAgeConfirmedUser: mocks.auth }))
vi.mock('@/lib/http/served-origin', () => ({ getServedOrigin: () => 'https://www.allfantasy.ai' }))
vi.mock('@/lib/import-os/collector/fantraxBrowserContext', () => ({ fantraxBrowserContext: mocks.context }))
vi.mock('@/lib/import-os/collector/fantraxBrowserActuals', () => ({ importFantraxBrowserActuals: mocks.importScores }))
vi.mock('@/lib/import-os/collector/fantraxTransactionSync', () => ({ fantraxTransactionContext: mocks.txContext, importFantraxTransactionExports: mocks.txImport }))

import { GET, POST } from '../app/api/leagues/import/fantrax-browser/route'
// @ts-expect-error — plain JS modules of the unpacked extension
import { downloadTransactionCsv, validateTransactionUrl } from '../tools/fantrax-browser-connector/download.js'
// @ts-expect-error — plain JS modules of the unpacked extension
import { transactionSummary } from '../tools/fantrax-browser-connector/summary.js'

const origin = 'https://www.allfantasy.ai'
const leagueId = 'ff59b139-03a8-47c6-82c0-59d6580670b4'
const url = (view = 'CLAIM_DROP') =>
  `https://www.fantrax.com/fxpa/downloadTransactionHistory?leagueId=abcdefgh1234&pageNumber=1&team=ALL&positionOrGroup=ALL&view=${view}&adminMode=false&includeDeleted=false&executedOnly=true`
const CLAIMS = '"Player","Team","Position","Type","Team","Bid","Date (EST)","Week"\n"A","PHI","WR","Claim","#1 T","1.00","Sat Nov 21, 2026, 9:00AM","11"'
const TRADES = '"Player","Team","Position","From","To","# Obj","Date (EST)","Week"\n"A","PHI","WR","#1 T","#2 U","0","Sat Nov 21, 2026, 9:00AM","11"'
const ok = (text: string) => vi.fn().mockResolvedValue({ ok: true, text: async () => text })

describe('the extension’s transaction download', () => {
  it('allows only the captured endpoint and exactly its parameters', () => {
    expect(validateTransactionUrl(url())).toBe(url())
    expect(validateTransactionUrl(url('TRADE'))).toBe(url('TRADE'))
    expect(() => validateTransactionUrl(url().replace('www.fantrax.com', 'evil.test'))).toThrow()
    expect(() => validateTransactionUrl(url().replace('downloadTransactionHistory', 'downloadTeamRosterStats'))).toThrow()
    expect(() => validateTransactionUrl(url('LINEUP'))).toThrow()
    expect(() => validateTransactionUrl(url().replace('adminMode=false', 'adminMode=true'))).toThrow()
    expect(() => validateTransactionUrl(url().replace('executedOnly=true', 'executedOnly=false'))).toThrow()
    expect(() => validateTransactionUrl(`${url()}&redirect=https://evil.test`)).toThrow()
    expect(() => validateTransactionUrl(url().replace('leagueId=abcdefgh1234', 'leagueId=../x'))).toThrow()
  })

  it('uses the browser session and sends no cookie header of its own', async () => {
    const fetcher = ok(CLAIMS)
    expect(await downloadTransactionCsv(url(), fetcher)).toBe(CLAIMS)
    const init = fetcher.mock.calls[0][1]
    expect(init.credentials).toBe('include')
    expect(init.redirect).toBe('error')
    expect(init.headers).toBeUndefined()
  })

  it('refuses a login error, an HTML page, and the other tab’s export', async () => {
    await expect(downloadTransactionCsv(url(), ok('{"pageError":{"code":"WARNING_NOT_LOGGED_IN"}}'))).rejects.toThrow('sign in')
    await expect(downloadTransactionCsv(url(), ok('<html>login</html>'))).rejects.toThrow('sign in')
    await expect(downloadTransactionCsv(url('CLAIM_DROP'), ok(TRADES))).rejects.toThrow()
    await expect(downloadTransactionCsv(url('TRADE'), ok(CLAIMS))).rejects.toThrow()
    expect(await downloadTransactionCsv(url('TRADE'), ok(TRADES))).toBe(TRADES)
  })

  it('stops on a rate limit without retrying', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 429 })
    await expect(downloadTransactionCsv(url(), fetcher)).rejects.toThrow('rate limit')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('says what each file did, including a file that was not saved', () => {
    expect(transactionSummary({
      trades: { ok: true, imported: 3, refused: [{}] },
      claimDrops: { ok: true, claims: 66, drops: 12, refused: [] },
    })).toBe('3 trades saved, 1 not placed. 66 claims and 12 drops saved.')
    expect(transactionSummary({ trades: { ok: false, error: 'The file is empty.' }, claimDrops: null })).toBe('Trades not saved: The file is empty..')
    expect(transactionSummary({ trades: null, claimDrops: null })).toBe('Nothing was downloaded.')
  })
})

describe('the connector API, kind=transactions', () => {
  const post = (value: unknown, source = origin) =>
    new NextRequest(`${origin}/api/leagues/import/fantrax-browser`, { method: 'POST', headers: { origin: source, 'content-type': 'application/json' }, body: JSON.stringify(value) })
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.auth.mockResolvedValue({ ok: true, userId: 'commish' })
    mocks.txContext.mockResolvedValue({ leagueId, leagueName: 'L', downloads: [] })
    mocks.txImport.mockResolvedValue({ trades: null, claimDrops: { ok: true, placed: 1 } })
  })

  it('returns the download addresses for a signed-in user, and hides why a league is refused', async () => {
    const good = await GET(new NextRequest(`${origin}/api/leagues/import/fantrax-browser?leagueId=${leagueId}&kind=transactions`))
    expect(good.status).toBe(200)
    expect(good.headers.get('cache-control')).toBe('no-store')
    expect(mocks.txContext).toHaveBeenCalledWith('commish', leagueId)
    expect(mocks.context).not.toHaveBeenCalled()
    mocks.txContext.mockRejectedValue(new Error('private detail'))
    const bad = await GET(new NextRequest(`${origin}/api/leagues/import/fantrax-browser?leagueId=${leagueId}&kind=transactions`))
    expect(bad.status).toBe(400)
    expect(await bad.text()).not.toContain('private detail')
  })

  it('passes only the league and the two files to the importer', async () => {
    const response = await POST(post({ kind: 'transactions', leagueId, trades: TRADES, claimDrops: CLAIMS, cookie: 'never-forward', apply: true }))
    expect(response.status).toBe(200)
    expect(mocks.txImport).toHaveBeenCalledWith('commish', { leagueId, trades: TRADES, claimDrops: CLAIMS })
    expect(mocks.importScores).not.toHaveBeenCalled()
    await POST(post({ kind: 'transactions', leagueId, claimDrops: CLAIMS }))
    expect(mocks.txImport).toHaveBeenLastCalledWith('commish', { leagueId, trades: null, claimDrops: CLAIMS })
  })

  it('refuses a cross-origin post, a signed-out user, and a batch with no file or a non-text file', async () => {
    expect((await POST(post({ kind: 'transactions', leagueId, claimDrops: CLAIMS }, 'https://other.example'))).status).toBe(403)
    expect((await POST(post({ kind: 'transactions', leagueId }))).status).toBe(400)
    expect((await POST(post({ kind: 'transactions', leagueId, claimDrops: 7 }))).status).toBe(400)
    expect((await POST(post({ kind: 'transactions', leagueId: 'nope', claimDrops: CLAIMS }))).status).toBe(400)
    expect(mocks.txImport).not.toHaveBeenCalled()
    mocks.auth.mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) })
    expect((await POST(post({ kind: 'transactions', leagueId, claimDrops: CLAIMS }))).status).toBe(401)
    expect(mocks.txImport).not.toHaveBeenCalled()
  })

  it('answers 400 without detail when the importer refuses the league', async () => {
    mocks.txImport.mockRejectedValue(new Error('League unavailable: private'))
    const response = await POST(post({ kind: 'transactions', leagueId, claimDrops: CLAIMS }))
    expect(response.status).toBe(400)
    expect(await response.text()).not.toContain('private')
  })
})
