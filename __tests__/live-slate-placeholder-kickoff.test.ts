import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

/**
 * "College Football 1" on a Saturday we held eight FBS games for.
 *
 * Two defects compounded, both measured on production 2026-08-29 08:15 ET:
 *
 *  1. Seven of the eight `espn_live` NCAAF rows for that day sat at exactly
 *     00:00 ET — ESPN's "kickoff not announced" placeholder, written 04-26 and
 *     never refreshed. The slate window opens at now-6h, midnight ET is outside
 *     it, and the games vanished.
 *  2. ESPN's scoreboard returned only ONE of the eight that morning. The
 *     provider loop breaks on the first non-empty response, so that single row
 *     became the entire scoreboard and the database was never consulted.
 *
 * Fixing either alone still shows one game.
 */
const findMany = vi.fn()
const findUnique = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsGame: { findMany: (...a: unknown[]) => findMany(...a) },
    sportsDataCache: { findUnique: (...a: unknown[]) => findUnique(...a) },
  },
}))

/** The seven placeholders and the one real row, as production held them. */
const ESPN_LIVE_TODAY = [
  { externalId: '401856766', away: 'UNC', home: 'TCU', kick: '2026-08-29T04:00:00.000Z' },
  { externalId: '401858201', away: 'HAW', home: 'STAN', kick: '2026-08-29T04:00:00.000Z' },
  { externalId: '401858202', away: 'NCSU', home: 'UVA', kick: '2026-08-29T04:00:00.000Z' },
  { externalId: '401862693', away: 'MEM', home: 'UNLV', kick: '2026-08-29T04:00:00.000Z' },
  { externalId: '401864570', away: 'NMSU', home: 'FSU', kick: '2026-08-29T04:00:00.000Z' },
  { externalId: '401864577', away: 'JVST', home: 'NDSU', kick: '2026-08-29T04:00:00.000Z' },
  { externalId: '401866408', away: 'SAC', home: 'EMU', kick: '2026-08-29T04:00:00.000Z' },
  { externalId: '401864494', away: 'SJSU', home: 'USC', kick: '2026-08-29T19:00:00.000Z' },
].map((g) => ({
  externalId: g.externalId,
  homeTeam: g.home,
  awayTeam: g.away,
  homeScore: null,
  awayScore: null,
  status: 'scheduled',
  startTime: new Date(g.kick),
  venue: null,
  week: 1,
  season: 2026,
  fetchedAt: new Date(
    g.externalId === '401864494' ? '2026-08-29T12:15:00.000Z' : '2026-04-26T12:30:00.000Z',
  ),
  source: 'espn_live',
}))

/** What `espn`/`cfbd` know about the same ESPN event ids. */
const SCHEDULE_DONORS = [
  { externalId: '401856766', kick: '2026-08-29T16:00:00.000Z' }, // 12:00 ET
  { externalId: '401858201', kick: '2026-08-29T23:00:00.000Z' }, // 19:00 ET
  { externalId: '401858202', kick: '2026-08-29T19:30:00.000Z' }, // 15:30 ET
  { externalId: '401862693', kick: '2026-08-30T02:00:00.000Z' }, // 22:00 ET
  { externalId: '401864570', kick: '2026-08-29T23:00:00.000Z' },
  { externalId: '401864577', kick: '2026-08-29T21:30:00.000Z' },
  { externalId: '401866408', kick: '2026-08-29T22:30:00.000Z' },
].map((g) => ({
  externalId: g.externalId,
  startTime: new Date(g.kick),
  fetchedAt: new Date('2026-08-29T07:21:00.000Z'),
}))

const NOW = Date.parse('2026-08-29T12:15:00.000Z')

/** Route the two queries the read path makes: slate rows, then kickoff donors. */
function wireDb(options: { slate: unknown[]; donors: unknown[] }) {
  findMany.mockImplementation((args: { where?: { source?: { in?: string[] } } }) => {
    const sources = args?.where?.source?.in ?? []
    if (sources.includes('espn') || sources.includes('cfbd')) return Promise.resolve(options.donors)
    return Promise.resolve(options.slate)
  })
  // No team directory in the test store: crests resolve to nothing, losslessly.
  findUnique.mockResolvedValue(null)
}

describe('placeholder kickoffs', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW))
    findMany.mockReset()
    findUnique.mockReset()
  })

  it('reads midnight Eastern as "not announced" for college football', async () => {
    const { isPlaceholderKickoff } = await import('@/lib/sports-live-scores-service')
    expect(isPlaceholderKickoff('NCAAF', new Date('2026-08-29T04:00:00.000Z'))).toBe(true)
    // 15:00 ET — a real kickoff, and the one row that was already correct.
    expect(isPlaceholderKickoff('NCAAF', new Date('2026-08-29T19:00:00.000Z'))).toBe(false)
    expect(isPlaceholderKickoff('NCAAF', null)).toBe(false)
  })

  it('leaves other sports alone at the same instant', async () => {
    // POSITIVE CONTROL. Every midnight-ET row in production is NCAAF, so this
    // must stay scoped; an NFL fixture at midnight ET is a real game.
    const { isPlaceholderKickoff } = await import('@/lib/sports-live-scores-service')
    expect(isPlaceholderKickoff('NFL', new Date('2026-08-29T04:00:00.000Z'))).toBe(false)
    expect(isPlaceholderKickoff('NBA', new Date('2026-08-29T04:00:00.000Z'))).toBe(false)
  })

  it('fills a placeholder from the schedule feed on the same ESPN event id', async () => {
    wireDb({ slate: ESPN_LIVE_TODAY, donors: SCHEDULE_DONORS })
    const { getCachedLiveScoresForSport } = await import('@/lib/sports-live-scores-service')

    const result = await getCachedLiveScoresForSport({ sport: 'NCAAF' })
    const byId = new Map(result.scores.map((s) => [s.gameId, s]))

    expect(byId.get('401856766')?.startTime).toBe('2026-08-29T16:00:00.000Z')
    expect(byId.get('401858202')?.startTime).toBe('2026-08-29T19:30:00.000Z')
    // The row that was already right is untouched.
    expect(byId.get('401864494')?.startTime).toBe('2026-08-29T19:00:00.000Z')
  })

  it('keeps the placeholder when no feed knows the kickoff', async () => {
    // Refusing to guess is the point. A fixture nobody has timed stays out of
    // the slate rather than being invented onto it.
    wireDb({ slate: ESPN_LIVE_TODAY, donors: [] })
    const { getCachedLiveScoresForSport } = await import('@/lib/sports-live-scores-service')

    const result = await getCachedLiveScoresForSport({ sport: 'NCAAF' })
    const unc = result.scores.find((s) => s.gameId === '401856766')
    expect(unc?.startTime).toBe('2026-08-29T04:00:00.000Z')
  })

  it('does not query the schedule feeds when nothing needs repair', async () => {
    wireDb({ slate: [ESPN_LIVE_TODAY[7]], donors: SCHEDULE_DONORS })
    const { getCachedLiveScoresForSport } = await import('@/lib/sports-live-scores-service')

    await getCachedLiveScoresForSport({ sport: 'NCAAF' })
    expect(findMany).toHaveBeenCalledTimes(1)
  })
})

describe('fixtures the live feed stopped reporting', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW))
    findMany.mockReset()
    findUnique.mockReset()
    findUnique.mockResolvedValue(null)
  })

  const liveRow = {
    gameId: '401864494',
    homeTeam: 'USC',
    homeTeamFull: 'USC Trojans',
    homeLogo: 'https://espn/usc.png',
    homeScore: 0,
    homeRecord: null,
    awayTeam: 'SJSU',
    awayTeamFull: 'San José State Spartans',
    awayLogo: 'https://espn/sjsu.png',
    awayScore: 0,
    awayRecord: null,
    status: 'STATUS_SCHEDULED',
    statusDetail: '8/29 - 3:00 PM EDT',
    period: 0,
    clock: '0:00',
    completed: false,
    startTime: '2026-08-29T19:00:00.000Z',
    venue: null,
    broadcast: null,
    odds: null,
    overUnder: null,
    week: 1,
    season: 2026,
    topPerformer: null,
  }

  it('restores the seven games ESPN dropped from its own scoreboard', async () => {
    const { withOmittedFixtures } = await import('@/lib/sports-live-scores-service')
    const merged = await withOmittedFixtures('NCAAF', 'espn_live', [liveRow], ESPN_LIVE_TODAY)

    expect(merged).toHaveLength(8)
    expect(merged.filter((g) => g.gameId === '401864494')).toHaveLength(1)
    expect(merged.map((g) => g.gameId)).toContain('401856766')
  })

  it('lets the live row win the collision', async () => {
    const { withOmittedFixtures } = await import('@/lib/sports-live-scores-service')
    const inPlay = { ...liveRow, status: 'STATUS_IN_PROGRESS', homeScore: 14, awayScore: 3 }
    const merged = await withOmittedFixtures('NCAAF', 'espn_live', [inPlay], ESPN_LIVE_TODAY)

    const usc = merged.find((g) => g.gameId === '401864494')
    // The cached row says `scheduled` with no score. Taking it would erase a
    // game that is on television — the exact failure this file keeps hitting.
    expect(usc?.status).toBe('STATUS_IN_PROGRESS')
    expect(usc?.homeScore).toBe(14)
    // And the live feed's own naming survives: the identity pass fills gaps on
    // restored rows and must never rewrite what the feed supplied.
    expect(usc?.awayTeamFull).toBe('San José State Spartans')
    expect(usc?.awayLogo).toBe('https://espn/sjsu.png')
  })

  it('never merges across sources', async () => {
    const { withOmittedFixtures } = await import('@/lib/sports-live-scores-service')
    const otherFeed = ESPN_LIVE_TODAY.map((r) => ({ ...r, source: 'thesportsdb' }))
    const merged = await withOmittedFixtures('NCAAF', 'espn_live', [liveRow], otherFeed)

    // TheSportsDB keys on its own ids and spells teams differently; merging it
    // in would show every fixture twice.
    expect(merged).toHaveLength(1)
  })

  it('leaves sports other than college football untouched', async () => {
    const { withOmittedFixtures } = await import('@/lib/sports-live-scores-service')
    const merged = await withOmittedFixtures('NFL', 'espn_live', [liveRow], ESPN_LIVE_TODAY)
    expect(merged).toHaveLength(1)
  })
})

/**
 * The restored fixtures read "MEM", "NMSU", "JVST" beside a live row reading
 * "San José State Spartans", because `espn_live` stores abbreviations and
 * `dbRowToLiveScore` has no full name to carry. The team directory was already
 * being consulted for the crest on the very same pass — the school name was
 * sitting in the resolved record, unused.
 */
const DIRECTORY = [
  {
    id: 153,
    school: 'North Carolina',
    mascot: 'Tar Heels',
    abbreviation: 'UNC',
    alternateNames: ['UNC', 'North Carolina'],
    classification: 'fbs',
    logo: 'https://cdn.collegefootballdata.com/logos/500/153.png',
  },
  {
    id: 2628,
    school: 'TCU',
    mascot: 'Horned Frogs',
    abbreviation: 'TCU',
    alternateNames: ['TCU'],
    classification: 'fbs',
    logo: 'https://cdn.collegefootballdata.com/logos/500/2628.png',
  },
]

describe('college team identity on restored rows', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW))
    findMany.mockReset()
    findUnique.mockReset()
  })

  it('fills the school name and crest an abbreviation stood in for', async () => {
    findMany.mockImplementation((args: { where?: { source?: { in?: string[] } } }) => {
      const sources = args?.where?.source?.in ?? []
      if (sources.includes('espn') || sources.includes('cfbd')) {
        return Promise.resolve(SCHEDULE_DONORS)
      }
      return Promise.resolve(ESPN_LIVE_TODAY.filter((r) => r.externalId === '401856766'))
    })
    findUnique.mockResolvedValue({ data: DIRECTORY, expiresAt: new Date(NOW + 1000) })

    const { getCachedLiveScoresForSport } = await import('@/lib/sports-live-scores-service')
    const { scores } = await getCachedLiveScoresForSport({ sport: 'NCAAF' })

    expect(scores[0]!.awayTeamFull).toBe('North Carolina')
    expect(scores[0]!.homeTeamFull).toBe('TCU')
    expect(scores[0]!.awayLogo).toContain('153.png')
    // The abbreviation itself is untouched — the card still needs it.
    expect(scores[0]!.awayTeam).toBe('UNC')
  })

  it('leaves the row alone when the directory has never been ingested', async () => {
    findMany.mockImplementation((args: { where?: { source?: { in?: string[] } } }) => {
      const sources = args?.where?.source?.in ?? []
      if (sources.includes('espn') || sources.includes('cfbd')) {
        return Promise.resolve(SCHEDULE_DONORS)
      }
      return Promise.resolve(ESPN_LIVE_TODAY.filter((r) => r.externalId === '401856766'))
    })
    findUnique.mockResolvedValue(null)

    const { getCachedLiveScoresForSport } = await import('@/lib/sports-live-scores-service')
    const { scores } = await getCachedLiveScoresForSport({ sport: 'NCAAF' })

    // Lossless: no directory means no name and no crest, never a wrong one.
    expect(scores[0]!.awayTeamFull).toBe('UNC')
    expect(scores[0]!.awayLogo).toBe('')
  })
})
