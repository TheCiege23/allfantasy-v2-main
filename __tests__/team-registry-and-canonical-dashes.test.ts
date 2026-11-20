/**
 * The team-metadata registry and canonical team names, as measured on production 2026-11-20.
 * Rows are the real college basketball ones (names, sources, Rolling Insights ids).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  sportsTeam: { findMany: vi.fn() },
  team: { findMany: vi.fn(), update: vi.fn(), create: vi.fn() },
  teamProviderIdentity: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

import { teamMetadataFromRows, type TeamMetadataRow } from '@/lib/sport-teams/SportTeamMetadataRegistry.db'
import { deriveCanonicalTeamIdentity, legacyCanonicalTeamName } from '@/lib/canonical/canonicalIdentity'
import { backfillCanonicalTeams } from '@/lib/canonical/backfillCanonical'

const row = (name: string, shortName: string | null, source: string, externalId: string, logo: string | null = `https://x/${externalId}.png`): TeamMetadataRow =>
  ({ name, shortName, source, externalId, logo, city: null, conference: null, division: null, primaryColor: null })

const ncaab = [
  row('Mercer University', 'MER', 'rolling_insights', '285'),
  row('Merrimack College', 'MER', 'rolling_insights', '354'),
  row('University of New Hampshire', 'UNH', 'rolling_insights', '7'),
  row('University of New Haven', 'UNH', 'rolling_insights', '369'),
  row('Villanova', 'NOVA', 'thesportsdb', '138661'),
  row('Villanova University', 'NOVA', 'rolling_insights', '76', null),
  row('University of Missouri-Kansas City', 'UMKC', 'rolling_insights', '357', null),
  row('University of Missouri–Kansas City', 'UMKC', 'rolling_insights', '347'),
  row('Auburn Tigers', null, 'thesportsdb', '138540'),
  row('Auburn University', 'AUB', 'rolling_insights', '33'),
]

describe('team-metadata registry', () => {
  const teams = teamMetadataFromRows('NCAAB', ncaab)
  const names = teams.map((t) => t.team_name).sort()

  it('lists every Rolling Insights school once, and both schools that share a code', () => {
    expect(names).toEqual(['Auburn University', 'Mercer University', 'Merrimack College', 'University of Missouri-Kansas City',
      'University of New Hampshire', 'University of New Haven', 'Villanova University'])
  })
  it('lends a crest from another provider only through a code naming one school', () => {
    expect(teams.find((t) => t.team_name === 'Villanova University')!.primary_logo_url).toBe('https://x/138661.png')
    // UMKC's two RI rows are one school; the entry takes the crest the other row has.
    expect(teams.find((t) => t.abbreviation === 'UMKC')!.primary_logo_url).toBe('https://x/347.png')
  })
  it('keeps the old one-per-code read for a sport without Rolling Insights rows', () => {
    const tsdb = [row('Lakers', 'LAL', 'thesportsdb', 'a'), row('Los Angeles Lakers', 'LAL', 'api_sports', 'b')]
    expect(teamMetadataFromRows('NBA', tsdb).map((t) => t.team_name)).toEqual(['Lakers'])
  })
})

describe('canonical team names fold the dash family', () => {
  it('makes the two UMKC spellings one canonical name', () => {
    const a = deriveCanonicalTeamIdentity({ name: 'University of Missouri-Kansas City', sport: 'NCAAB' })
    const b = deriveCanonicalTeamIdentity({ name: 'University of Missouri–Kansas City', sport: 'NCAAB' })
    expect(b.normalizedName).toBe(a.normalizedName)
    expect(legacyCanonicalTeamName('University of Missouri–Kansas City')).toBe('university of missouri–kansas city')
  })
})

describe('canonical backfill', () => {
  beforeEach(() => vi.clearAllMocks())

  it('finds a team stored under the old dash form, and rewrites it rather than creating a second', async () => {
    prismaMock.sportsTeam.findMany.mockResolvedValue([{ id: 's', sport: 'NCAAB', name: 'University of Wisconsin–Green Bay',
      shortName: 'GB', city: null, conference: null, division: null, logo: null, externalId: '61', source: 'rolling_insights' }])
    // Answer only what is asked for: the stored row under its OLD (en dash) name.
    const stored = [{ id: 'old', normalizedName: 'university of wisconsin–green bay' }]
    prismaMock.team.findMany.mockImplementation(async ({ where }: { where: { normalizedName: string | { in: string[] } } }) => {
      const wanted = typeof where.normalizedName === 'string' ? [where.normalizedName] : where.normalizedName.in
      return stored.filter((t) => wanted.includes(t.normalizedName))
    })
    prismaMock.team.create.mockResolvedValue({ id: 'new' })
    prismaMock.team.update.mockResolvedValue({ id: 'old' })
    prismaMock.teamProviderIdentity.findFirst.mockResolvedValue({ id: 'ident' })
    await backfillCanonicalTeams({ sport: 'NCAAB' })
    expect(prismaMock.team.create).not.toHaveBeenCalled()
    expect(prismaMock.team.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'old' },
      data: expect.objectContaining({ normalizedName: 'university of wisconsin-green bay' }) }))
  })
})
