import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  EspnBlockedError,
  fetchEspnNcaabRoster,
  fetchEspnNcaabTeams,
  parseEspnNcaabRoster,
  parseEspnNcaabTeams,
} from '@/lib/espn/espnNcaabFetch'
import { matchRoster, matchSchools, type RiSchool } from '@/lib/espn/ncaabEspnMatch'

/** Committed by contracts/espn/scripts/probe.sh on 2026-10-01 — real shapes, not hand-made ones. */
const fixture = (name: string) =>
  JSON.parse(readFileSync(join(process.cwd(), 'contracts/espn/fixtures', name), 'utf8')) as unknown

describe('espnNcaabFetch parsers, against the committed fixtures', () => {
  it('reads the school name from `location`, not the mascot in `name`', () => {
    const [t] = parseEspnNcaabTeams(fixture('teams.NCAAB.json'))
    expect(t).toMatchObject({ id: expect.stringMatching(/^\d+$/), location: expect.any(String) })
    expect(t!.location).not.toBe('Wildcats')
    expect(t!.logo).toMatch(/^https:\/\/a\.espncdn\.com\//)
  })

  it.each([
    ['roster.NCAAB.team150.json', 15, 8],
    ['roster.NCAAB.team2057.json', 14, 14],
    ['roster.NCAAB.team2441.json', 20, 18],
  ])('%s: %i athletes, %i with a headshot — an absent field is null, never ""', (file, n, withPhoto) => {
    const { seasonYear, athletes } = parseEspnNcaabRoster(fixture(file))
    expect(seasonYear).toBe(2027)
    expect(athletes).toHaveLength(n)
    expect(athletes.filter((a) => a.headshotUrl).length).toBe(withPhoto)
    expect(athletes.every((a) => a.headshotUrl === null || a.headshotUrl.startsWith('https://'))).toBe(true)
    // ⚠ jersey is a STRING on the wire (contracts/espn GAPS R-06).
    expect(athletes.every((a) => typeof a.jersey === 'string')).toBe(true)
  })
})

describe('espnNcaabFetch transport', () => {
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response

  it('asks the working host, with the limit that returns every team', async () => {
    const fetchImpl = vi.fn(async () => ok({ sports: [] }))
    await fetchEspnNcaabTeams({ fetchImpl: fetchImpl as never })
    const url = new URL(fetchImpl.mock.calls[0]![0] as unknown as string)
    expect(url.host).toBe('site.web.api.espn.com')
    expect(url.pathname).toBe('/apis/site/v2/sports/basketball/mens-college-basketball/teams')
    expect(url.searchParams.get('limit')).toBe('1000')
  })

  it('throws EspnBlockedError on 403 — the caller stops, nothing retries around it', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 403 }) as unknown as Response)
    await expect(fetchEspnNcaabRoster('150', { fetchImpl: fetchImpl as never })).rejects.toBeInstanceOf(EspnBlockedError)
  })

  it('refuses a team id that is not numeric rather than building a URL from it', async () => {
    const fetchImpl = vi.fn()
    await expect(fetchEspnNcaabRoster('150/../x', { fetchImpl: fetchImpl as never })).rejects.toThrow(/not an ESPN team id/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('matchSchools', () => {
  const espn = [
    { id: '150', location: 'Duke', abbreviation: 'DUKE' },
    { id: '251', location: 'Texas', abbreviation: 'TEX' },
    { id: '245', location: 'Texas A&M', abbreviation: 'TA&M' },
    { id: '2638', location: 'UTEP', abbreviation: 'UTEP' },
    { id: '26', location: 'UCLA', abbreviation: 'UCLA' },
    { id: '103', location: 'Boston College', abbreviation: 'BC' },
    { id: '104', location: 'Boston University', abbreviation: 'BU' },
    { id: '160', location: 'New Hampshire', abbreviation: 'UNH' },
    { id: '2441', location: 'New Haven', abbreviation: 'NHVN' },
  ]
  const ri = (externalId: string, name: string, shortName: string): RiSchool => ({ externalId, name, shortName })

  it('exact school name', () => {
    expect(matchSchools([ri('37', 'Duke University', 'DUKE')], espn, {}).matches).toEqual([
      { espnId: '150', riExternalId: '37', rule: 'exact' },
    ])
  })

  it('partial name only with the abbreviation agreeing — Texas is not Texas A&M or UTEP', () => {
    const r = matchSchools(
      [ri('64', 'University of Texas at Austin', 'TEX'), ri('145', 'University of Texas at El Paso', 'UTEP')],
      espn,
      {},
    )
    expect(r.matches).toContainEqual({ espnId: '251', riExternalId: '64', rule: 'subset+abbreviation' })
    // "Texas" IS a subset of "texas el paso" — only the abbreviation stops a wrong link here.
    expect(r.matches).toContainEqual({ espnId: '2638', riExternalId: '145', rule: 'abbreviation' })
    expect(r.matches.find((m) => m.riExternalId === '145')?.espnId).not.toBe('251')
  })

  it('initialism names through the abbreviation, when it is unique on both sides', () => {
    expect(matchSchools([ri('248', 'University of California, Los Angeles', 'UCLA')], espn, {}).matches).toEqual([
      { espnId: '26', riExternalId: '248', rule: 'abbreviation' },
    ])
  })

  it('refuses an abbreviation RI uses for two schools (UNH = New Hampshire AND New Haven)', () => {
    const r = matchSchools([ri('7', 'Univ of N Hampshire', 'UNH'), ri('369', 'Univ of N Haven', 'UNH')], espn, {})
    expect(r.matches).toEqual([])
    expect(r.unmatched.map((u) => u.externalId).sort()).toEqual(['369', '7'])
  })

  it('refuses names that collapse to the same key, and a reviewed alias resolves them', () => {
    const schools = [ri('35', 'Boston College', 'BC'), ri('259', 'Boston University', 'BU')]
    expect(matchSchools(schools, espn, {}).matches).toEqual([])
    expect(matchSchools(schools, espn, { '35': '103', '259': '104' }).matches).toEqual([
      { espnId: '103', riExternalId: '35', rule: 'alias' },
      { espnId: '104', riExternalId: '259', rule: 'alias' },
    ])
  })

  it('an ESPN school claimed by two RI schools is refused for both', () => {
    const r = matchSchools([ri('1', 'Duke University', 'X1'), ri('2', 'Duke College', 'X2')], espn, {})
    expect(r.matches).toEqual([])
    expect(r.ambiguous).toHaveLength(2)
  })
})

describe('matchRoster', () => {
  const a = (id: string, fullName: string, jersey: string | null) => ({ id, fullName, jersey })
  const p = (externalId: string, name: string, number: number | null) => ({ externalId, name, number })

  it('needs name AND jersey; the string jersey matches the int number', () => {
    expect(matchRoster([a('9', 'Eoin Dillon', '5')], [p('13049', 'Eoin Dillon', 5)]).matches).toEqual([
      { athleteId: '9', riExternalId: '13049' },
    ])
  })

  it('a name under a different jersey is not a match — RI keeps former players (GAPS M-01)', () => {
    const r = matchRoster([a('9', 'Jack Scott', '4')], [p('1', 'Jack Scott', 20)])
    expect(r.matches).toEqual([])
    expect(r.noCandidate).toBe(1)
  })

  it('never matches on jersey alone — Duke has three #2s on file', () => {
    const r = matchRoster([a('9', 'Someone New', '2')], [p('1', 'Jaylen Blakes', 2), p('2', 'Cassius Stanley', 2)])
    expect(r.matches).toEqual([])
  })

  it('normalizes suffixes and punctuation the way the rest of the repo does', () => {
    expect(matchRoster([a('9', 'Deron Rippey Jr.', '3')], [p('1', 'Deron Rippey', 3)]).matches).toHaveLength(1)
  })

  it('refuses two RI rows with the same name and jersey', () => {
    const r = matchRoster([a('9', 'Sam Orme', '14')], [p('1', 'Sam Orme', 14), p('2', 'Sam Orme', 14)])
    expect(r.matches).toEqual([])
    expect(r.refused).toBe(1)
  })

  it('refuses both athletes when they claim one RI row', () => {
    const r = matchRoster([a('8', 'Sam Orme', '14'), a('9', 'Sam Orme', '14')], [p('1', 'Sam Orme', 14)])
    expect(r.matches).toEqual([])
    expect(r.refused).toBe(2)
  })

  it('real data: Belmont 2026-27 ESPN roster vs our 28 Belmont ACT rows -> 10 matched, 4 newcomers, 0 refused', () => {
    // Our rows, read from production SportsPlayer on 2026-10-01 (name, jersey). Includes former players.
    const belmont: Array<[string, number]> = [
      ['Win Miller', 0], ['Tyler Scanlon', 0], ['Mitch Listau', 1], ['Grayson Murphy', 2], ['Luke Smith', 3],
      ['Aidan Noyes', 4], ['Garrett Suedekum', 4], ['Eoin Dillon', 5], ['Adam Kunkel', 5], ['Tyler Lundblade', 8],
      ['Caleb Hollander', 10], ['Jabez Jenkins', 10], ['Drew Scharnowski', 11], ['Michael Shanks', 11],
      ['Ej Bellinger', 12], ['Brigham Rogers', 12], ['Cooper Haynes', 13], ['Sam Orme', 14], ['Nick Hopkins', 14],
      ['Tate Pierson', 20], ['Derek Sabin', 21], ['Ben Sheppard', 22], ['Jake Dykstra', 23], ['Keith Robbins', 24],
      ['Michael Benkert', 24], ['Nick Muszynski', 33], ['Rilee Epley', 42], ['Seth Adelsperger', 50],
    ]
    const { athletes } = parseEspnNcaabRoster(fixture('roster.NCAAB.team2057.json'))
    const r = matchRoster(athletes, belmont.map(([name, number], i) => p(String(i), name, number)))
    expect(r.matches).toHaveLength(10)
    expect(r.noCandidate).toBe(4) // freshmen/transfers RI has not loaded (GAPS M-02)
    expect(r.refused).toBe(0)
  })
})
