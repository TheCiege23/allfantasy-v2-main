import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * `getPlayerDataForSurface` fills `teamLogoUrl` database-first outside the NFL: the record's own
 * logo, then the stored crest (`SportsTeam.logo`), then the static guess — and a guess ESPN never
 * serves (college/soccer by name) is dropped at every step. The NFL path is untouched and must not
 * read `sportsTeam` at all.
 */
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn() },
    roster: { findFirst: vi.fn() },
    sportsPlayerRecord: { findUnique: vi.fn(), findMany: vi.fn() },
    sportsPlayer: { findMany: vi.fn() },
    fantasyPlayer: { findMany: vi.fn() },
    sportsTeam: { findMany: vi.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import { getPlayerDataForSurface } from '@/lib/player-data/getPlayerDataForSurface'
import { clearStoredTeamLogoCache } from '@/lib/sport-teams/storedTeamLogos'

const CREST = 'https://a.espncdn.com/i/teamlogos/ncaa/500/194.png'

function record(sport: string, team: string, logoUrl: string | null) {
  return {
    id: 'rec-1',
    sport,
    name: 'Some Athlete',
    team,
    position: 'WR',
    stats: {},
    projections: {},
    dataSource: 'rolling_insights',
    headshotSource: 'cdn',
    injuryStatus: null,
    adp: null,
    headshotUrl: null,
    headshotUrlSm: null,
    headshotUrlLg: null,
    logoUrl,
  }
}

/**
 * The logo the UI renders. `display.assets.teamLogoUrl` is never null — it falls back to an inline
 * "TM" placeholder — so a missing crest reads as a `data:` URL there and `null` on `display.team`.
 * Both are asserted: the display layer rebuilt this from the static registry and dropped the stored
 * crest entirely until `normalizePoolRowToEntry` honoured `metadata.teamLogoUrl`.
 */
async function logoFor(sport: string, team: string, logoUrl: string | null): Promise<string | null> {
  vi.mocked(prisma.league.findUnique).mockResolvedValue({ sport } as never)
  const rec = record(sport, team, logoUrl)
  vi.mocked(prisma.sportsPlayerRecord.findUnique).mockResolvedValue(rec as never)
  vi.mocked(prisma.sportsPlayerRecord.findMany).mockResolvedValue([rec] as never)
  const rows = await getPlayerDataForSurface({ surface: 'roster', leagueId: 'lg', userId: 'u', limit: 5 })
  expect(rows).toHaveLength(1)
  const display = (rows[0] as unknown as {
    display: { assets: { teamLogoUrl: string }; team: { logoUrl: string | null } | null }
  }).display
  const asset = display.assets.teamLogoUrl.startsWith('data:') ? null : display.assets.teamLogoUrl
  expect(asset).toBe(display.team?.logoUrl ?? null)
  return asset
}

describe('getPlayerDataForSurface team logo', () => {
  beforeEach(() => {
    clearStoredTeamLogoCache()
    vi.mocked(prisma.roster.findFirst).mockResolvedValue({ playerData: ['rec-1'] } as never)
    vi.mocked(prisma.sportsPlayer.findMany).mockResolvedValue([] as never)
    vi.mocked((prisma as unknown as { fantasyPlayer: { findMany: ReturnType<typeof vi.fn> } }).fantasyPlayer.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.sportsTeam.findMany).mockReset()
    vi.mocked(prisma.sportsTeam.findMany).mockResolvedValue([
      { externalId: '194', name: 'Ohio State Buckeyes', shortName: 'Ohio State', city: null, logo: CREST, source: 'cfbd' },
    ] as never)
  })

  it('a college player gets the stored crest', async () => {
    expect(await logoFor('NCAAF', 'Ohio State', null)).toBe(CREST)
  })

  it('a dead guess on the record is skipped in favour of the stored crest', async () => {
    expect(await logoFor('NCAAF', 'Ohio State', 'https://a.espncdn.com/i/teamlogos/ncaaf/500/osu.png')).toBe(CREST)
  })

  it('the record\'s own live logo still wins', async () => {
    expect(await logoFor('NCAAF', 'Ohio State', 'https://r2.example/osu.png')).toBe('https://r2.example/osu.png')
  })

  it('no stored crest and no record logo leaves null, not a guessed 404', async () => {
    expect(await logoFor('NCAAF', 'Nowhere Tech', null)).toBeNull()
  })

  it('the NFL never reads stored crests', async () => {
    const logo = await logoFor('NFL', 'KC', null)
    expect(prisma.sportsTeam.findMany).not.toHaveBeenCalled()
    expect(logo).toMatch(/\/nfl\//)
  })
})
