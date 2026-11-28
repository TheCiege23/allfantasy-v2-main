/**
 * ESPN current-team headshots for NBA / NHL / MLB (owner decision 2026-11-27, contracts/espn GAPS E-08).
 * The parser is checked against the committed captures, flat (NBA) and grouped by position (NHL, MLB).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { parseEspnProRoster } from '@/lib/espn/espnProRosterFetch'
import { isEspnProHeadshot, isEspnProSport } from '@/lib/espn/espnProHeadshots'
import { matchProAthletes, replaceableRowPhoto, type ProRow } from '@/lib/espn/proEspnHeadshotIngest'

const fixture = (name: string) => JSON.parse(readFileSync(join(process.cwd(), 'contracts/espn/fixtures', name), 'utf8'))

describe('parseEspnProRoster (committed captures)', () => {
  it.each([
    ['NBA', 'roster.NBA.team12.json'],
    ['NHL', 'roster.NHL.team13.json'],
    ['MLB', 'roster.MLB.team10.json'],
  ])('%s: every athlete parses, flat or grouped, and each headshot is that sport\'s ESPN CDN path', (sport, file) => {
    const body = fixture(file)
    const raw = body.athletes as Array<{ items?: unknown[] }>
    const expected = raw.flatMap((g) => (Array.isArray(g.items) ? g.items : [g])).length
    const out = parseEspnProRoster(body)
    expect(out.rejectedCount).toBe(0)
    expect(out.athletes).toHaveLength(expected)
    expect(out.athletes.length).toBeGreaterThan(0)
    for (const a of out.athletes) {
      expect(a.id).toMatch(/^\d+$/)
      if (a.headshotUrl) expect(isEspnProHeadshot(a.headshotUrl, sport)).toBe(true)
    }
    expect(out.seasonYear).toBe(body.season.year)
  })

  it('NHL and MLB really are grouped in the captures (the shape the parser must flatten)', () => {
    expect(Array.isArray(fixture('roster.NHL.team13.json').athletes[0].items)).toBe(true)
    expect(Array.isArray(fixture('roster.MLB.team10.json').athletes[0].items)).toBe(true)
    expect(fixture('roster.NBA.team12.json').athletes[0].items).toBeUndefined()
  })
})

describe('isEspnProHeadshot', () => {
  it('recognises the pro paths, by sport when asked, and nothing else', () => {
    expect(isEspnProHeadshot('https://a.espncdn.com/i/headshots/nba/players/full/4396907.png')).toBe(true)
    expect(isEspnProHeadshot('https://a.espncdn.com/i/headshots/nba/players/full/4396907.png', 'NBA')).toBe(true)
    expect(isEspnProHeadshot('https://a.espncdn.com/i/headshots/nba/players/full/4396907.png', 'NHL')).toBe(false)
    expect(isEspnProHeadshot('https://a.espncdn.com/i/headshots/mens-college-basketball/players/full/1.png')).toBe(false)
    expect(isEspnProHeadshot('https://r2.thesportsdb.com/images/media/player/cutout/x.png')).toBe(false)
    expect(isEspnProHeadshot(null)).toBe(false)
    expect(isEspnProSport('nba')).toBe(true)
    expect(isEspnProSport('NFL')).toBe(false)
  })
})

const row = (id: string, name: string, extra: Partial<ProRow> = {}): ProRow => ({ id, externalId: `ri-${id}`, name, number: null, status: 'ACT', imageUrl: null, ...extra })
const athlete = (id: string, fullName: string, jersey: string | null, headshot = true) => ({
  id, fullName, jersey, headshotUrl: headshot ? `https://a.espncdn.com/i/headshots/nba/players/full/${id}.png` : null,
})

describe('matchProAthletes', () => {
  it('links a unique name — the traded player whose old photo this replaces', () => {
    const tsdb = 'https://r2.thesportsdb.com/images/media/player/cutout/7fxsg11766875246.png'
    const { links } = matchProAthletes([athlete('4396907', 'Darius Garland', '10')], [row('1042', 'Darius Garland', { number: 10, imageUrl: tsdb })])
    expect(links).toEqual([{ rowId: '1042', externalId: 'ri-1042', athleteId: '4396907', headshotUrl: 'https://a.espncdn.com/i/headshots/nba/players/full/4396907.png', currentImageUrl: tsdb }])
  })

  it('a shared name narrows to the active row, then to the jersey; still two is refused', () => {
    const rows = [row('a', 'Marcus Morris', { number: 13 }), row('b', 'Marcus Morris', { number: 8 }), row('c', 'Marcus Morris', { status: 'RET', number: 13 })]
    expect(matchProAthletes([athlete('1', 'Marcus Morris Sr.', '8')], rows).links.map((l) => l.rowId)).toEqual(['b'])
    const twins = [row('a', 'Jaylen Williams', { number: 6 }), row('b', 'Jaylen Williams', { number: 6 })]
    expect(matchProAthletes([athlete('1', 'Jaylen Williams', '6')], twins)).toMatchObject({ links: [], refused: 1 })
  })

  it('a row two athletes both claim is refused for both; an athlete with no photo or no namesake is skipped', () => {
    const out = matchProAthletes(
      [athlete('1', 'Same Name', '1'), athlete('2', 'Same Name', '2'), athlete('3', 'No Photo', '3', false), athlete('4', 'Nobody Here', '4')],
      [row('x', 'Same Name'), row('y', 'No Photo')],
    )
    expect(out.links).toEqual([])
    expect(out.refused).toBe(2)
    expect(out.noCandidate).toBe(1)
  })
})

describe('replaceableRowPhoto', () => {
  it('replaces an empty, TheSportsDB, api-sports or older ESPN photo; keeps any other', () => {
    expect(replaceableRowPhoto(null)).toBe(true)
    expect(replaceableRowPhoto('https://r2.thesportsdb.com/images/media/player/cutout/x.png')).toBe(true)
    expect(replaceableRowPhoto('https://media.api-sports.io/basketball/players/1.png')).toBe(true)
    expect(replaceableRowPhoto('https://a.espncdn.com/i/headshots/nba/players/full/9.png')).toBe(true)
    expect(replaceableRowPhoto('https://cdn.allfantasy.ai/players/custom.png')).toBe(false)
  })
})
