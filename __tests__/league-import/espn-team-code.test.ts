// @vitest-environment node
/**
 * The ESPN team code — the phone path for proving which ESPN team is yours (`espnTeamCode.ts`).
 *
 * Three layers, each with a control that has to go RED:
 *   1. the code itself: stable, private to (user, league), always readable off a phone;
 *   2. matching: only the whole abbreviation or a whole word, and never two teams at once;
 *   3. end to end through the REAL NFL capture: no cookies, code on a team → that team is the
 *      viewer's (`viewerTeamProof: 'team_code'`), and the commissioner gate passes on it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fixture from '../../contracts/espn/fixtures/fantasy-league.NFL.2026.json'

vi.mock('@/lib/league-sync-core', () => ({ getDecryptedAuth: vi.fn(async () => null) }))
const db = vi.hoisted(() => ({ playerIdentityMap: { findMany: vi.fn(async () => [] as unknown[]) } }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import {
  ESPN_TEAM_CODE_LENGTH,
  espnTeamCodeFor,
  findEspnTeamIdByCode,
  resolveEspnViewerTeamWithCode,
} from '@/lib/league-import/espn/espnTeamCode'
import { fetchEspnLeagueForImport } from '@/lib/league-import/espn/EspnLeagueFetchService'

const KEY = 'test-secret:espn-team-code:v1'
const SAFE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]+$/

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function serve(league: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/communication/')) return json({ messages: ['not authorized'] }, 401)
      if (/\/seasons\/2026\//.test(url)) return json(league)
      return json({ messages: ['not found'] }, 404)
    }),
  )
}

/** The real capture with one team's abbreviation set to `abbrev`. */
function leagueWithAbbrev(teamId: number, abbrev: string) {
  const copy = JSON.parse(JSON.stringify(fixture)) as any
  copy.teams.find((t: any) => t.id === teamId).abbrev = abbrev
  return copy
}

describe('espnTeamCodeFor', () => {
  it('is stable, four characters, phone-safe, and always mixes a letter and a digit', () => {
    for (let i = 0; i < 300; i++) {
      const code = espnTeamCodeFor(`user-${i}`, String(100000 + i), KEY)!
      expect(code).toHaveLength(ESPN_TEAM_CODE_LENGTH)
      expect(code).toMatch(SAFE)
      expect(code).toMatch(/[0-9]/)
      expect(code).toMatch(/[A-Z]/)
      expect(espnTeamCodeFor(`user-${i}`, String(100000 + i), KEY)).toBe(code)
    }
  })

  it('differs by user, by league and by key — nobody else can compute yours', () => {
    const mine = espnTeamCodeFor('u1', '123456', KEY)
    expect(espnTeamCodeFor('u2', '123456', KEY)).not.toBe(mine)
    expect(espnTeamCodeFor('u1', '654321', KEY)).not.toBe(mine)
    expect(espnTeamCodeFor('u1', '123456', 'another-key')).not.toBe(mine)
  })

  it('ignores leading zeros in the league id, and is null with no key or no input', () => {
    expect(espnTeamCodeFor('u1', '00123456', KEY)).toBe(espnTeamCodeFor('u1', '123456', KEY))
    expect(espnTeamCodeFor('u1', '123456', null)).toBeNull()
    expect(espnTeamCodeFor('', '123456', KEY)).toBeNull()
    expect(espnTeamCodeFor('u1', '  ', KEY)).toBeNull()
  })
})

describe('findEspnTeamIdByCode', () => {
  const teams = (extra: Record<string, unknown>[]) => ({
    teams: [{ id: 1, abbrev: 'TBF', name: 'Tribal Beef' }, { id: 2, abbrev: 'KING', name: 'The Kings' }, ...extra],
  })

  it('finds the team whose abbreviation is the code, in any case', () => {
    expect(findEspnTeamIdByCode(teams([{ id: 3, abbrev: 'k9x2', name: 'Third' }]), 'K9X2')).toBe('3')
  })

  it('finds the code as a whole word of the team name', () => {
    expect(findEspnTeamIdByCode(teams([{ id: 3, abbrev: 'T3', name: 'Beef K9X2 Squad' }]), 'K9X2')).toBe('3')
    expect(findEspnTeamIdByCode(teams([{ id: 3, location: 'K9X2', nickname: 'Squad' }]), 'K9X2')).toBe('3')
  })

  it('does NOT match the code inside a longer word (control)', () => {
    expect(findEspnTeamIdByCode(teams([{ id: 3, abbrev: 'K9X22', name: 'AK9X2B' }]), 'K9X2')).toBeNull()
  })

  it('refuses when two teams carry the code — proof must point at exactly one', () => {
    expect(
      findEspnTeamIdByCode(teams([{ id: 3, abbrev: 'K9X2' }, { id: 4, name: 'Also K9X2' }]), 'K9X2'),
    ).toBeNull()
  })

  it('is null for no match, a malformed code, or a malformed payload', () => {
    expect(findEspnTeamIdByCode(teams([]), 'K9X2')).toBeNull()
    expect(findEspnTeamIdByCode(teams([{ id: 3, abbrev: 'K9' }]), 'K9')).toBeNull()
    expect(findEspnTeamIdByCode(null, 'K9X2')).toBeNull()
    expect(findEspnTeamIdByCode({ teams: 'nope' }, 'K9X2')).toBeNull()
  })
})

describe('resolveEspnViewerTeamWithCode', () => {
  beforeEach(() => vi.stubEnv('NEXTAUTH_SECRET', 'test-secret'))
  afterEach(() => vi.unstubAllEnvs())

  it('lets the SWID cookie win whenever it answers', () => {
    const code = espnTeamCodeFor('u1', '123456')!
    const raw = { teams: [{ id: 7, abbrev: code }] }
    expect(resolveEspnViewerTeamWithCode({ raw, swidTeamId: '2', userId: 'u1', espnLeagueId: '123456' })).toEqual({
      teamId: '2',
      proof: 'swid',
    })
  })

  it('falls back to the code only when the cookie cannot answer', () => {
    const code = espnTeamCodeFor('u1', '123456')!
    const raw = { teams: [{ id: 7, abbrev: code }] }
    expect(resolveEspnViewerTeamWithCode({ raw, swidTeamId: null, userId: 'u1', espnLeagueId: '123456' })).toEqual({
      teamId: '7',
      proof: 'team_code',
    })
    // Someone else's code on that team proves nothing for u2.
    expect(resolveEspnViewerTeamWithCode({ raw, swidTeamId: null, userId: 'u2', espnLeagueId: '123456' })).toEqual({
      teamId: null,
      proof: null,
    })
  })

  it('offers nothing when no signing secret is configured', () => {
    vi.stubEnv('NEXTAUTH_SECRET', '')
    vi.stubEnv('AUTH_SECRET', '')
    const raw = { teams: [{ id: 7, abbrev: espnTeamCodeFor('u1', '123456', 'x')! }] }
    expect(resolveEspnViewerTeamWithCode({ raw, swidTeamId: null, userId: 'u1', espnLeagueId: '123456' }).proof).toBeNull()
  })
})

describe('end to end through the real NFL capture, with no cookies', () => {
  beforeEach(() => {
    vi.stubEnv('NEXTAUTH_SECRET', 'test-secret')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('control: the untouched league identifies no team for the importer', async () => {
    serve(fixture)
    const payload = await fetchEspnLeagueForImport('u1', '2026:123456', { includePreviousSeasons: false })
    expect(payload.viewerTeamId).toBeNull()
    expect(payload.viewerTeamProof).toBeNull()
    expect(payload.viewerEspnConnected).toBe(false)
  })

  it('the code on team 4 makes team 4 the importer’s', async () => {
    serve(leagueWithAbbrev(4, espnTeamCodeFor('u1', '123456')!))
    const payload = await fetchEspnLeagueForImport('u1', '2026:123456', { includePreviousSeasons: false })
    expect(payload.viewerTeamId).toBe('4')
    expect(payload.viewerTeamProof).toBe('team_code')
  })

  it('another user’s code on that team does not (control)', async () => {
    serve(leagueWithAbbrev(4, espnTeamCodeFor('someone-else', '123456')!))
    const payload = await fetchEspnLeagueForImport('u1', '2026:123456', { includePreviousSeasons: false })
    expect(payload.viewerTeamId).toBeNull()
  })

  it('the commissioner gate passes on the code and claims that team’s owner', async () => {
    serve(leagueWithAbbrev(4, espnTeamCodeFor('u1', '123456')!))
    const { assertImportCommissioner } = await import('@/lib/league-import/commissionerGate')
    const result = await assertImportCommissioner({
      appUserId: 'u1',
      provider: 'espn',
      sourceLeagueId: '2026:123456',
      requireCommissioner: true,
    })
    expect(result.ok).toBe(true)
    // The proven team's owner, from the capture — what gets claimed for the importer.
    const owner = (fixture as any).teams.find((t: any) => t.id === 4).owners[0]
    expect(result.sourceManagerId).toBe(owner)
  })

  it('and without the code it refuses exactly as before (control)', async () => {
    serve(fixture)
    const { assertImportCommissioner } = await import('@/lib/league-import/commissionerGate')
    const result = await assertImportCommissioner({
      appUserId: 'u1',
      provider: 'espn',
      sourceLeagueId: '2026:123456',
      requireCommissioner: true,
    })
    expect(result.ok).toBe(false)
    expect(result.leagueReadable).toBe(true)
  })
})
