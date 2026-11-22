// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Fantrax team logos, read from the logged-in site by the browser connector.
 *
 * Fantrax's public API sends no picture (contracts/fantrax/GAPS.md F-14), so every Fantrax team showed a letter:
 * 0 of 209 team rows had one on production. The site's own `getFantasyTeams` request lists a logo per team (F-20).
 * Prisma is mocked; nothing here calls Fantrax.
 */
const m = vi.hoisted(() => ({
  commissioner: true,
  league: { name: 'Test Dynasty', platform: 'fantrax', platformLeagueId: 'snap-1' } as Record<string, unknown> | null,
  snapshot: { sourceLeagueId: 'abcdefgh1234', transactions: { fantraxDraft: { kept: true } } } as Record<string, any> | null,
  teams: [] as Array<Record<string, any>>,
  teamUpdates: [] as Array<Record<string, any>>,
  snapshotUpdates: [] as Array<Record<string, any>>,
  txContext: vi.fn(),
  txImport: vi.fn(),
  auth: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/league/commissionerAccess', () => ({ canCommissionerAct: async () => m.commissioner }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn(async () => m.league) },
    fantraxLeague: {
      findUnique: vi.fn(async () => m.snapshot),
      update: vi.fn(async (args: Record<string, any>) => { m.snapshotUpdates.push(args); return {} }),
    },
    leagueTeam: {
      findMany: vi.fn(async () => m.teams),
      update: vi.fn(async (args: Record<string, any>) => { m.teamUpdates.push(args); return {} }),
    },
  },
}))
vi.mock('@/lib/league-import/fantrax/importFantraxTradeHistory', () => ({ importFantraxTradeHistory: vi.fn() }))
vi.mock('@/lib/league-import/fantrax/importFantraxClaimDropHistory', () => ({ importFantraxClaimDropHistory: vi.fn() }))

import { fantraxLogoUrl, readStoredFantraxTeamLogos, withStoredFantraxTeamLogos } from '@/lib/league-import/fantrax/fantraxSnapshotHistory'
import { fantraxTeamLogoContext, importFantraxTeamLogos } from '@/lib/import-os/collector/fantraxTeamLogoSync'
// @ts-expect-error — plain JS modules of the unpacked extension
import { fetchFantasyTeams, validateTeamsRequest } from '../tools/fantrax-browser-connector/download.js'
// @ts-expect-error — plain JS modules of the unpacked extension
import { logoSummary } from '../tools/fantrax-browser-connector/summary.js'

/* Addresses come from the committed capture, never retyped. */
const capture = JSON.parse(readFileSync(join(__dirname, '..', 'contracts', 'fantrax', 'fixtures', '2026-fantasy-teams-request.json'), 'utf8'))
const SOURCE = 'abcdefgh1234'
const requestUrl = `${capture.request.origin}${capture.request.path}?leagueId=${SOURCE}`
const refUrl = String(capture.request.body.refUrl).replace('<sourceLeagueId>', SOURCE)
const IMG = new URL(capture.response.sample[0].logoUrl256).origin
const logo = (file: string) => `${IMG}/logos/abc/${file}`

beforeEach(() => {
  m.commissioner = true
  m.league = { name: 'Test Dynasty', platform: 'fantrax', platformLeagueId: 'snap-1' }
  m.snapshot = { sourceLeagueId: SOURCE, transactions: { fantraxDraft: { kept: true } } }
  m.teams = [
    { id: 'row-1', externalId: '1', teamName: '#5 Harbor Owls', platformUserId: null, avatarUrl: null },
    { id: 'row-2', externalId: '2', teamName: '#9 Mesa Comets', platformUserId: null, avatarUrl: logo('comets_256.webp') },
    { id: 'row-3', externalId: '3', teamName: '#2 River Foxes', platformUserId: null, avatarUrl: null },
  ]
  m.teamUpdates.length = 0
  m.snapshotUpdates.length = 0
})

describe('fantraxLogoUrl', () => {
  it('accepts an uploaded logo and a stock icon on Fantrax’s image server', () => {
    expect(fantraxLogoUrl(logo('tmLogo_x1_256.webp'))).toBe(logo('tmLogo_x1_256.webp'))
    expect(fantraxLogoUrl(`${IMG}/assets/images/icons/fantasyteams/football/foam_fingers/red.png`)).toBe(`${IMG}/assets/images/icons/fantasyteams/football/foam_fingers/red.png`)
  })

  it('refuses every other host, scheme, path and shape', () => {
    for (const bad of [
      logo('a.webp').replace('https:', 'http:'),
      logo('a.webp').replace('fantraximg.com', 'fantraximg.com.evil.test'),
      logo('a.webp').replace('fantraximg.com', 'evil.test'),
      `${logo('a.webp')}?next=https://evil.test`,
      `${logo('a.webp')}#x`,
      logo('a.svg'),
      logo('a.webp').replace('/logos/', '/other/'),
      `${IMG}/logos/../secret/a.webp`,
      'javascript:alert(1)',
      'data:image/png;base64,AAAA',
      '',
      null,
      42,
    ]) expect(fantraxLogoUrl(bad), String(bad)).toBeNull()
  })
})

describe('the snapshot’s stored logos', () => {
  it('keeps every other stored key, and reads back only valid logos', () => {
    const stored = withStoredFantraxTeamLogos({ fantraxDraft: { kept: true }, fantraxFuturePicks: { picks: [] } }, [
      { teamId: 'team00000001', teamName: '#5 Harbor Owls', logoUrl: logo('owls_256.webp') },
    ], '2026-11-22T00:00:00.000Z')
    expect(stored.fantraxDraft).toEqual({ kept: true })
    expect(stored.fantraxFuturePicks).toEqual({ picks: [] })
    expect(readStoredFantraxTeamLogos(stored)).toEqual([{ teamId: 'team00000001', teamName: '#5 Harbor Owls', logoUrl: logo('owls_256.webp') }])
    expect(readStoredFantraxTeamLogos({ fantraxTeamLogos: { logos: [{ teamId: 't', logoUrl: 'https://evil.test/a.png' }, { logoUrl: logo('a.webp') }] } })).toEqual([])
    expect(readStoredFantraxTeamLogos(null)).toEqual([])
  })
})

describe('importFantraxTeamLogos', () => {
  const list = [
    { id: 'team00000001', name: '#5 Harbor Owls', logoUrl: logo('owls_256.webp') },
    { id: 'team00000002', name: '#9 Mesa Comets', logoUrl: logo('comets_256.webp') },
    { id: 'team00000003', name: '#4 Ghost Team', logoUrl: logo('ghost_256.webp') },
    { id: 'team00000004', name: '#2 River Foxes', logoUrl: 'https://evil.test/foxes.png' },
  ]

  it('sets each matched team’s picture, leaves an unchanged one alone, and reports the rest', async () => {
    const result = await importFantraxTeamLogos('u-comm', { leagueId: 'af-league', teams: list })
    expect(result).toEqual({ listed: 4, saved: 1, unchanged: 1, unmatched: ['#4 Ghost Team'], refused: 1 })
    expect(m.teamUpdates).toEqual([{ where: { id: 'row-1' }, data: { avatarUrl: logo('owls_256.webp') } }])
  })

  it('keeps the accepted logos on the league snapshot beside what was already stored', async () => {
    await importFantraxTeamLogos('u-comm', { leagueId: 'af-league', teams: list })
    expect(m.snapshotUpdates).toHaveLength(1)
    const stored = m.snapshotUpdates[0]!.data.transactions
    expect(m.snapshotUpdates[0]!.where).toEqual({ id: 'snap-1' })
    expect(stored.fantraxDraft).toEqual({ kept: true })
    expect(readStoredFantraxTeamLogos(stored).map((l) => l.teamId)).toEqual(['team00000001', 'team00000002', 'team00000003'])
  })

  it('never gives two listed teams the same row', async () => {
    const result = await importFantraxTeamLogos('u-comm', {
      leagueId: 'af-league',
      teams: [
        { id: 'team00000001', name: '#5 Harbor Owls', logoUrl: logo('owls_256.webp') },
        { id: 'team00000009', name: 'Harbor Owls', logoUrl: logo('other_256.webp') },
      ],
    })
    expect(result.saved).toBe(1)
    expect(result.unmatched).toEqual(['Harbor Owls'])
    expect(m.teamUpdates).toHaveLength(1)
  })

  it('is for the commissioner of an imported Fantrax league only, and writes nothing otherwise', async () => {
    m.commissioner = false
    await expect(importFantraxTeamLogos('u-member', { leagueId: 'af-league', teams: list })).rejects.toThrow()
    await expect(fantraxTeamLogoContext('u-member', 'af-league')).rejects.toThrow()
    m.commissioner = true
    await expect(importFantraxTeamLogos('u-comm', { leagueId: 'af-league', teams: [] })).rejects.toThrow()
    await expect(importFantraxTeamLogos('u-comm', { leagueId: 'af-league', teams: Array.from({ length: 101 }, () => list[0]!) })).rejects.toThrow()
    expect(m.teamUpdates).toHaveLength(0)
    expect(m.snapshotUpdates).toHaveLength(0)
  })

  it('hands the connector exactly the captured request address', async () => {
    const context = await fantraxTeamLogoContext('u-comm', 'af-league')
    expect(context).toMatchObject({ leagueName: 'Test Dynasty', requestUrl, refUrl })
  })
})

describe('the extension’s team list request', () => {
  const answer = (body: unknown, ok = true, status = 200) => vi.fn().mockResolvedValue({ ok, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) })
  const teams = { responses: [{ data: { fantasyTeams: [{ id: 'team00000001', name: '#5 Harbor Owls', shortName: 'OWL', logoUrl128: logo('owls_128.webp'), logoUrl256: logo('owls_256.webp'), logoId: 'x', commissioner: true }] } }] }

  it('allows only the captured endpoint for one league and its own home page as the referring page', () => {
    expect(validateTeamsRequest(requestUrl, refUrl)).toEqual({ href: requestUrl, ref: refUrl })
    expect(() => validateTeamsRequest(requestUrl.replace('www.fantrax.com', 'evil.test'), refUrl)).toThrow()
    expect(() => validateTeamsRequest(requestUrl.replace('/fxpa/req', '/fxpa/other'), refUrl)).toThrow()
    expect(() => validateTeamsRequest(`${requestUrl}&extra=1`, refUrl)).toThrow()
    expect(() => validateTeamsRequest(requestUrl, refUrl.replace(SOURCE, 'otherleague99'))).toThrow()
    expect(() => validateTeamsRequest(requestUrl, `${refUrl}?x=1`)).toThrow()
  })

  it('sends the captured body with the browser session, and returns only id, name and logo', async () => {
    const fetcher = answer(teams)
    expect(await fetchFantasyTeams(requestUrl, refUrl, fetcher)).toEqual([{ id: 'team00000001', name: '#5 Harbor Owls', logoUrl: logo('owls_256.webp') }])
    const [href, init] = fetcher.mock.calls[0]
    expect(href).toBe(requestUrl)
    expect(init).toMatchObject({ method: 'POST', credentials: 'include', redirect: 'error', headers: capture.request.headers })
    expect(JSON.parse(init.body)).toEqual({ ...capture.request.body, refUrl })
  })

  it('refuses a login error, a non-JSON page, an empty list, and stops on a rate limit', async () => {
    await expect(fetchFantasyTeams(requestUrl, refUrl, answer({ pageError: { code: 'WARNING_NOT_LOGGED_IN' } }))).rejects.toThrow('sign in')
    await expect(fetchFantasyTeams(requestUrl, refUrl, answer('<html>login</html>'))).rejects.toThrow('sign in')
    await expect(fetchFantasyTeams(requestUrl, refUrl, answer({ responses: [{ data: { fantasyTeams: [] } }] }))).rejects.toThrow('sign in')
    const limited = answer('', false, 429)
    await expect(fetchFantasyTeams(requestUrl, refUrl, limited)).rejects.toThrow('rate limit')
    expect(limited).toHaveBeenCalledTimes(1)
  })

  it('says what the sync did', () => {
    expect(logoSummary({ listed: 34, saved: 30, unchanged: 2, unmatched: ['a', 'b'], refused: 0 })).toBe('32 of 34 team logos in place, 30 new, 2 teams not matched by name.')
    expect(logoSummary({ listed: 34, saved: 0, unchanged: 34, unmatched: [], refused: 0 })).toBe('34 of 34 team logos in place.')
  })
})
