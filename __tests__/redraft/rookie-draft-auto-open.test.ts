import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * A dynasty league's rookie draft opens on its sport's calendar — created in pre-draft, never
 * started — once a commissioner has turned auto-open on. Nothing scheduled one before: the only way
 * in was "Create next draft".
 */

const m = vi.hoisted(() => ({
  seasonFindMany: vi.fn(),
  seasonFindFirst: vi.fn(),
  leagueFindUnique: vi.fn(),
  leagueUpdate: vi.fn(),
  createNext: vi.fn(),
  publish: vi.fn(),
  draftState: vi.fn(),
  hasPlan: vi.fn(),
  dispatch: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    redraftSeason: { findMany: m.seasonFindMany, findFirst: m.seasonFindFirst },
    league: { findUnique: m.leagueFindUnique, update: m.leagueUpdate },
  },
}))
vi.mock('@/lib/live-draft-engine/createNextLeagueDraft', () => ({ createNextLeagueDraft: m.createNext }))
vi.mock('@/lib/league-events/publisher', () => ({ publishLeagueFanoutEvent: m.publish }))
vi.mock('@/lib/redraft/offseason/startDynastyNewSeason', () => ({ rookieDraftState: m.draftState }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: m.dispatch }))

import { openDynastyRookieDraftsOnCalendar } from '@/lib/redraft/offseason/openRookieDraftsOnCalendar'
import { ROOKIE_DRAFT_CALENDAR_SETTINGS_KEY } from '@/lib/dynasty-core/rookieDraftCalendar'

const ON = { [ROOKIE_DRAFT_CALENDAR_SETTINGS_KEY]: { autoOpen: true } }

/** Next season's shell, created when the champion was crowned. */
function shell(sport: string, season: number, createdAt: string, settings: unknown = ON, lifecycleMetadata: unknown = {}) {
  return {
    id: `${sport}-${season}`,
    season,
    status: 'setup',
    createdAt: new Date(createdAt),
    currentWeek: 0,
    leagueId: `L-${sport}`,
    sport,
    league: { settings, leagueType: 'dynasty', isDynasty: true, lifecycleMetadata, userId: 'commish', name: 'Dynasty Den' },
  }
}

const preseason = vi.fn(async () => ({ ok: true, phase: 'preseason' }))

async function run(now: string, resolveWeek = preseason) {
  return openDynastyRookieDraftsOnCalendar({
    now: new Date(now),
    limit: 50,
    actorUserId: 'system:week-roller',
    nativePlatforms: ['af', 'native'],
    resolveWeek,
    commissionerHasPlan: m.hasPlan,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  m.seasonFindFirst.mockResolvedValue({ id: 'prior-complete' })
  m.draftState.mockResolvedValue('none')
  m.leagueFindUnique.mockResolvedValue({ lifecycleMetadata: { lastTransitionFrom: 'offseason', nextDraftCreated: 'D-new' } })
  m.leagueUpdate.mockResolvedValue({})
  m.publish.mockResolvedValue(undefined)
  m.hasPlan.mockResolvedValue(false)
  m.dispatch.mockResolvedValue(undefined)
  m.createNext.mockImplementation(async (leagueId: string) => ({
    ok: true,
    sessionId: `D-${leagueId}`,
    kind: 'rookie',
    seasonId: 's',
    season: 2027,
    rounds: 4,
    orderSource: 'standings',
    keepersPlaced: 0,
    playersCarried: 60,
    tradedPicksApplied: 0,
  }))
})

describe('each sport opens on its own window', () => {
  const cases: Array<[string, string, string, string]> = [
    // sport, offseason began (shell created), the day before the window, the window's first hour
    ['NFL', '2027-01-12T05:00:00Z', '2027-04-30T12:00:00Z', '2027-05-01T12:00:00Z'],
    ['NBA', '2027-04-20T05:00:00Z', '2027-06-30T12:00:00Z', '2027-07-01T12:00:00Z'],
    ['NHL', '2027-04-25T05:00:00Z', '2027-06-30T12:00:00Z', '2027-07-01T12:00:00Z'],
    // MLB: the 2026 season ends in October; the 2027 first-year-player draft opens 1 November 2026.
    ['MLB', '2026-10-04T05:00:00Z', '2026-10-31T12:00:00Z', '2026-11-01T12:00:00Z'],
  ]

  for (const [sport, createdAt, before, opens] of cases) {
    it(`${sport}: held before ${opens.slice(0, 10)}, opened from then`, async () => {
      m.seasonFindMany.mockResolvedValue([shell(sport, 2027, createdAt)])

      const early = await run(before)
      expect(early).toEqual([expect.objectContaining({ action: 'held', detail: expect.stringMatching(/^WINDOW_NOT_OPEN:/) })])
      expect(m.createNext).not.toHaveBeenCalled()

      const onTime = await run(opens)
      expect(onTime).toEqual([
        expect.objectContaining({ action: 'opened', detail: 'sport_default', sessionId: `D-L-${sport}` }),
      ])
      expect(m.createNext).toHaveBeenCalledTimes(1)
      expect(m.createNext).toHaveBeenCalledWith(`L-${sport}`, 'system:week-roller')
    })
  }

  it('MLB opens in the offseason after its season — not in the January of the seeded year', async () => {
    m.seasonFindMany.mockResolvedValue([shell('MLB', 2027, '2026-10-04T05:00:00Z')])
    expect((await run('2026-12-01T12:00:00Z'))[0].action).toBe('opened')
  })
})

describe('creates, does not start, and tells the league', () => {
  it('records the marker and announces to every member, deduped per season', async () => {
    m.seasonFindMany.mockResolvedValue([shell('NFL', 2027, '2027-01-12T05:00:00Z')])
    await run('2027-05-01T13:00:00Z')

    const meta = m.leagueUpdate.mock.calls[0][0].data.lifecycleMetadata
    // Merged over what createNextLeagueDraft wrote, not replacing it.
    expect(meta).toMatchObject({
      nextDraftCreated: 'D-new',
      rookieDraftAutoOpened: { seasonId: 'NFL-2027', season: 2027, sessionId: 'D-L-NFL', windowSource: 'sport_default' },
    })
    expect(m.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        leagueId: 'L-NFL',
        eventType: 'rookie_draft_opened',
        category: 'league_announcements',
        visibility: 'all_members',
        dedupeKey: 'rookie-draft-open:NFL-2027',
      }),
    )
    // Nothing here starts picking — creation only. The draft is created by the same path as the button.
    expect(m.createNext).toHaveBeenCalledTimes(1)
  })
})

describe('never a second draft', () => {
  it('a league already auto-opened for this season is skipped (a deleted draft is not re-created)', async () => {
    m.seasonFindMany.mockResolvedValue([
      shell('NFL', 2027, '2027-01-12T05:00:00Z', ON, { rookieDraftAutoOpened: { seasonId: 'NFL-2027' } }),
    ])
    expect(await run('2027-05-02T12:00:00Z')).toEqual([expect.objectContaining({ action: 'held', detail: 'ALREADY_AUTO_OPENED' })])
    expect(m.createNext).not.toHaveBeenCalled()
  })

  it('last season\'s marker does not block this season', async () => {
    m.seasonFindMany.mockResolvedValue([
      shell('NFL', 2027, '2027-01-12T05:00:00Z', ON, { rookieDraftAutoOpened: { seasonId: 'NFL-2026' } }),
    ])
    expect((await run('2027-05-02T12:00:00Z'))[0].action).toBe('opened')
  })

  it('skips a league whose commissioner already created the draft (still open)', async () => {
    m.seasonFindMany.mockResolvedValue([shell('NBA', 2027, '2027-04-20T05:00:00Z')])
    m.draftState.mockResolvedValue('open')
    expect(await run('2027-07-02T12:00:00Z')).toEqual([expect.objectContaining({ action: 'held', detail: 'DRAFT_ALREADY_OPEN' })])
    expect(m.createNext).not.toHaveBeenCalled()
  })

  it('skips a league whose commissioner already ran it', async () => {
    m.seasonFindMany.mockResolvedValue([shell('NBA', 2027, '2027-04-20T05:00:00Z')])
    m.draftState.mockResolvedValue('complete')
    expect((await run('2027-07-02T12:00:00Z'))[0].detail).toBe('ROOKIE_DRAFT_DONE')
    expect(m.createNext).not.toHaveBeenCalled()
  })

  it('a refusal from createNextLeagueDraft writes no marker and announces nothing', async () => {
    m.seasonFindMany.mockResolvedValue([shell('NFL', 2027, '2027-01-12T05:00:00Z')])
    m.createNext.mockResolvedValue({ ok: false, code: 'DRAFT_STILL_OPEN', message: 'x' })
    expect((await run('2027-05-02T12:00:00Z'))[0]).toMatchObject({ action: 'held', detail: 'DRAFT_STILL_OPEN' })
    expect(m.leagueUpdate).not.toHaveBeenCalled()
    expect(m.publish).not.toHaveBeenCalled()
  })
})

describe('guards', () => {
  it('auto-open is off for a free league unless the commissioner turned it on', async () => {
    m.seasonFindMany.mockResolvedValue([shell('NFL', 2027, '2027-01-12T05:00:00Z', {})])
    expect(await run('2027-05-02T12:00:00Z')).toEqual([expect.objectContaining({ action: 'held', detail: 'AUTO_OPEN_OFF' })])
    expect(m.createNext).not.toHaveBeenCalled()
  })

  it('never opens once the sport\'s week 1 has begun — an open draft would hold a season being played', async () => {
    m.seasonFindMany.mockResolvedValue([shell('NFL', 2027, '2027-01-12T05:00:00Z')])
    const out = await run('2027-09-12T12:00:00Z', vi.fn(async () => ({ ok: true, phase: 'regular_season' })))
    expect(out[0].detail).toBe('SEASON_KICKED_OFF')
    const unresolved = await run('2027-09-12T12:00:00Z', vi.fn(async () => ({ ok: false, reason: 'NO_SCHEDULE_ROWS' })))
    expect(unresolved[0].detail).toBe('WEEK_UNRESOLVED:NO_SCHEDULE_ROWS')
    expect(m.createNext).not.toHaveBeenCalled()
  })

  it('a league\'s first season is never given a rookie draft', async () => {
    m.seasonFindMany.mockResolvedValue([shell('NFL', 2027, '2027-01-12T05:00:00Z')])
    m.seasonFindFirst.mockResolvedValue(null)
    expect((await run('2027-05-02T12:00:00Z'))[0].detail).toBe('first_season')
  })
})

describe('commissioner custom open date', () => {
  it('overrides the sport default in both directions', async () => {
    const early = { [ROOKIE_DRAFT_CALENDAR_SETTINGS_KEY]: { autoOpen: true, customOpenDate: '2027-04-20' } }
    m.seasonFindMany.mockResolvedValue([shell('NFL', 2027, '2027-01-12T05:00:00Z', early)])
    const out = await run('2027-04-21T12:00:00Z')
    expect(out[0]).toMatchObject({ action: 'opened', detail: 'custom' })

    vi.clearAllMocks()
    m.seasonFindFirst.mockResolvedValue({ id: 'prior-complete' })
    m.draftState.mockResolvedValue('none')
    const late = { [ROOKIE_DRAFT_CALENDAR_SETTINGS_KEY]: { autoOpen: true, customOpenDate: '2027-06-15' } }
    m.seasonFindMany.mockResolvedValue([shell('NFL', 2027, '2027-01-12T05:00:00Z', late)])
    // The sport default (May 1) has passed, but the commissioner pushed it to June 15.
    const held = await run('2027-05-20T12:00:00Z')
    expect(held[0].detail).toBe('WINDOW_NOT_OPEN:2027-06-15T12:00:00.000Z')
    expect(m.createNext).not.toHaveBeenCalled()
  })
})

describe('AF Commissioner opens the rookie draft by default', () => {
  // Every offseason in these cases began after the plan default shipped (2026-10-28), except where said.
  it('a Commissioner-plan league with no switch set opens on the window', async () => {
    m.hasPlan.mockResolvedValue(true)
    m.seasonFindMany.mockResolvedValue([shell('NFL', 2027, '2027-01-12T05:00:00Z', {})])
    expect((await run('2027-05-01T12:00:00Z'))[0]).toMatchObject({ action: 'opened', detail: 'sport_default' })
    expect(m.hasPlan).toHaveBeenCalledWith('commish')
    expect(m.createNext).toHaveBeenCalledTimes(1)
  })

  it('the commissioner switching it off wins over the plan, and the plan is not even asked', async () => {
    m.hasPlan.mockResolvedValue(true)
    const off = { [ROOKIE_DRAFT_CALENDAR_SETTINGS_KEY]: { autoOpen: false } }
    m.seasonFindMany.mockResolvedValue([shell('NFL', 2027, '2027-01-12T05:00:00Z', off)])
    expect((await run('2027-05-01T12:00:00Z'))[0].detail).toBe('AUTO_OPEN_OFF')
    expect(m.hasPlan).not.toHaveBeenCalled()
    expect(m.createNext).not.toHaveBeenCalled()
  })

  it('a free league with no switch set stays off', async () => {
    m.seasonFindMany.mockResolvedValue([shell('NFL', 2027, '2027-01-12T05:00:00Z', {})])
    expect((await run('2027-05-01T12:00:00Z'))[0].detail).toBe('AUTO_OPEN_OFF')
    expect(m.dispatch).not.toHaveBeenCalled()
  })

  describe('an offseason already under way when the default shipped', () => {
    // An MLB league crowned in early October 2026; its window opens 1 November.
    const predates = () => shell('MLB', 2027, '2026-10-04T05:00:00Z', {})

    it('creates no draft, even inside the window, and tells the commissioner once', async () => {
      m.hasPlan.mockResolvedValue(true)
      m.seasonFindMany.mockResolvedValue([predates()])
      expect((await run('2026-11-02T12:00:00Z'))[0].detail).toBe('AUTO_OPEN_OFF_PREDATES_PLAN_DEFAULT')
      expect(m.createNext).not.toHaveBeenCalled()
      expect(m.dispatch).toHaveBeenCalledTimes(1)
      expect(m.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          userIds: ['commish'],
          category: 'commissioner_alerts',
          type: 'rookie_draft_auto_open_available',
          leagueId: 'L-MLB',
          dedupePrefix: 'rookie_draft_auto_open_available:MLB-2027',
        }),
      )
      // Merged over existing metadata, keyed to this season.
      expect(m.leagueUpdate.mock.calls[0][0].data.lifecycleMetadata).toMatchObject({
        nextDraftCreated: 'D-new',
        rookieDraftAutoOpenNotice: { seasonId: 'MLB-2027', season: 2027 },
      })
    })

    it('is not told again once the marker is written', async () => {
      m.hasPlan.mockResolvedValue(true)
      m.seasonFindMany.mockResolvedValue([
        shell('MLB', 2027, '2026-10-04T05:00:00Z', {}, { rookieDraftAutoOpenNotice: { seasonId: 'MLB-2027' } }),
      ])
      await run('2026-11-03T12:00:00Z')
      expect(m.dispatch).not.toHaveBeenCalled()
      expect(m.leagueUpdate).not.toHaveBeenCalled()
    })

    it('is not told when the commissioner already created the draft, or it is the league\'s first season', async () => {
      m.hasPlan.mockResolvedValue(true)
      m.seasonFindMany.mockResolvedValue([predates()])
      m.draftState.mockResolvedValue('open')
      await run('2026-11-02T12:00:00Z')
      m.draftState.mockResolvedValue('none')
      m.seasonFindFirst.mockResolvedValue(null)
      await run('2026-11-02T12:00:00Z')
      expect(m.dispatch).not.toHaveBeenCalled()
    })

    it('opens normally once the commissioner turns it on', async () => {
      m.hasPlan.mockResolvedValue(true)
      m.seasonFindMany.mockResolvedValue([shell('MLB', 2027, '2026-10-04T05:00:00Z', ON)])
      expect((await run('2026-11-02T12:00:00Z'))[0].action).toBe('opened')
      expect(m.dispatch).not.toHaveBeenCalled()
    })

    it('a free league in the same position is neither opened nor told', async () => {
      m.seasonFindMany.mockResolvedValue([predates()])
      expect((await run('2026-11-02T12:00:00Z'))[0].detail).toBe('AUTO_OPEN_OFF')
      expect(m.dispatch).not.toHaveBeenCalled()
    })
  })
})
