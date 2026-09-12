import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    gameSchedule: {
      count: vi.fn(),
    },
    sportsGame: {
      findMany: vi.fn(),
    },
    sportsInjury: {
      findMany: vi.fn(),
    },
    worldCupBracketMatch: {
      findFirst: vi.fn(),
    },
  },
}))

const fetchFantasyCalcValuesMock = vi.hoisted(() => vi.fn())
const getEnrichedNewsFeedMock = vi.hoisted(() => vi.fn())
const getCachedGameWeatherMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/fantasycalc', () => ({
  fetchFantasyCalcValues: fetchFantasyCalcValuesMock,
  findPlayerByName: (players: any[], name: string) =>
    players.find((row) => row.player.name.toLowerCase() === name.toLowerCase()) ?? null,
  getValueTier: (value: number) => value >= 5000 ? 'high' : 'mid',
}))


// These modules read through the DB-first layer now, so mocking only the
// adapter stopped intercepting and the real prisma-backed path ran.
vi.mock('@/lib/fantasycalc-db', () => ({
  getFantasyCalcValuesDbFirst: fetchFantasyCalcValuesMock,
}))

vi.mock('@/lib/fantasy-news-aggregator/FantasyNewsAggregatorService', () => ({
  getEnrichedNewsFeed: getEnrichedNewsFeedMock,
}))

vi.mock('@/lib/weather/weatherService', () => ({
  getCachedGameWeather: getCachedGameWeatherMock,
}))

/*
 * The live feed, mocked at the SOURCE rather than at `readStatLeaders`, so the
 * real aggregation and the real name matching both run in these tests. Mocking
 * the reader would have made the per-player assertions test the mock.
 */
const readPlayByPlayFeedMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/live/playByPlayFeed', () => ({
  readPlayByPlayFeed: readPlayByPlayFeedMock,
}))

import { prisma } from '@/lib/prisma'
import {
  detectScheduleQuestion,
  detectLiveGamesQuestion,
  checkScheduleContextAvailable,
  tryDeterministicAnswer,
  tryDeterministicAnswerDetailed,
  DETERMINISTIC_SOURCE,
} from '@/lib/ai/deterministic'

const mockCount = prisma.gameSchedule.count as ReturnType<typeof vi.fn>
const mockSportsGameFindMany = (prisma as any).sportsGame.findMany as ReturnType<typeof vi.fn>
const mockSportsInjuryFindMany = (prisma as any).sportsInjury.findMany as ReturnType<typeof vi.fn>
const mockWorldCupMatchFindFirst = (prisma as any).worldCupBracketMatch.findFirst as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.resetAllMocks()
  mockSportsGameFindMany.mockResolvedValue([])
  mockSportsInjuryFindMany.mockResolvedValue([])
  mockWorldCupMatchFindFirst.mockResolvedValue(null)
  getEnrichedNewsFeedMock.mockResolvedValue([])
  getCachedGameWeatherMock.mockResolvedValue(null)
  /* Default: no live games. `resetAllMocks` clears this, so it must be re-set. */
  readPlayByPlayFeedMock.mockResolvedValue([])
})

// ── detectScheduleQuestion ────────────────────────────────────────────────────

describe('detectScheduleQuestion', () => {
  const shouldMatch = [
    'What sports games are being played today?',
    'what games are on today',
    'Are any games on tonight?',
    'games today',
    'What games are on tonight?',
    "tonight's games",
    "today's schedule",
    "today's matchups",
    'What sports are on today?',
    'What sports are happening tonight?',
    'NBA games today',
    'NFL games tonight',
    'Are there MLB games today?',
    "what's on tonight",
    "what is on today",
    'any games on now?',
    'games being played today',
    'NHL games tonight',
    'soccer games today',
    'ncaa games today',
    /* The production wording that was NOT recognised, and so reached the forward-only tool. */
    'what college football games are on right now?',
  ]

  const shouldNotMatch = [
    'What is my rank?',
    'Explain my bracket.',
    'Who should I start this week?',
    'How many points do I need to win?',
    'Who is the best quarterback?',
    'Trade advice?',
    'Tell me about my roster.',
    'What are the standings?',
  ]

  for (const msg of shouldMatch) {
    it(`matches: "${msg}"`, () => {
      expect(detectScheduleQuestion(msg)).toBe(true)
    })
  }

  for (const msg of shouldNotMatch) {
    it(`does not match: "${msg}"`, () => {
      expect(detectScheduleQuestion(msg)).toBe(false)
    })
  }
})

// ── detectLiveGamesQuestion ───────────────────────────────────────────────────

describe('detectLiveGamesQuestion', () => {
  it('recognizes the exact natural-language phrasing used by the current-games UI report', () => {
    expect(detectLiveGamesQuestion('what college football games are on right now?')).toBe(true)
    expect(detectLiveGamesQuestion('Who is playing now?')).toBe(true)
    expect(detectLiveGamesQuestion('Show me live NCAAF games')).toBe(true)
  })

  it('does not swallow ordinary forward-looking schedule questions', () => {
    expect(detectLiveGamesQuestion('What games are on Saturday?')).toBe(false)
    expect(detectLiveGamesQuestion('When is the next college football game?')).toBe(false)
  })
})

// ── the live-games fast path ──────────────────────────────────────────────────

/**
 * 🛑 THE BUG THESE PIN IS NOT A TIMEZONE BUG. A live ESPN college-football slate was
 * reported as "no games" because the wording was not recognised as a live-game request, so
 * the model reached for the only games tool available — a forward-looking schedule tool that
 * excludes anything already kicked off. An offset error moves games by hours; this dropped
 * exactly the games that had STARTED.
 */
describe('the live-games fast path answers from the score cache', () => {
  it('answers the reported college-football live-game wording from the DB without entering the model path', async () => {
    const now = new Date()
    const kickoff = new Date(now.getTime() - 90 * 60 * 1_000)
    /*
     * Two rows for ONE fixture, which is the normal shape: SportsGame is unique on
     * (sport, externalId, source). The `cfbd` row is NEWER and says `scheduled`; the `espn`
     * row is slightly older and says `in_progress`. Taking the newest row per fixture would
     * report a game at 20-48 in the second half as not yet started.
     */
    mockSportsGameFindMany.mockResolvedValueOnce([
      {
        sport: 'NCAAF', externalId: 'cfbd-1', awayTeam: 'Arizona State', homeTeam: 'Texas A&M',
        awayScore: null, homeScore: null, status: 'scheduled', startTime: kickoff,
        source: 'cfbd', fetchedAt: now,
      },
      {
        sport: 'NCAAF', externalId: 'espn-1', awayTeam: 'Arizona State', homeTeam: 'Texas A&M',
        awayScore: 20, homeScore: 48, status: 'in_progress', startTime: kickoff,
        source: 'espn', fetchedAt: new Date(now.getTime() - 30_000),
      },
    ])

    const result = await tryDeterministicAnswerDetailed('what college football games are on right now?')

    expect(result?.kind).toBe('answer')
    expect(result?.text).toContain('Live NCAAF games')
    expect(result?.text).toContain('Arizona State @ Texas A&M — 20-48')
    expect(mockSportsGameFindMany).toHaveBeenCalledOnce()
    /* `gameSchedule.count` is the schedule-availability probe: proving the slow path was skipped. */
    expect(mockCount).not.toHaveBeenCalled()
  })

  it('does not claim there are no live games when the score cache is stale', async () => {
    const now = new Date()
    mockSportsGameFindMany.mockResolvedValueOnce([{
      sport: 'NCAAF', externalId: 'espn-stale', awayTeam: 'Oklahoma', homeTeam: 'Michigan',
      awayScore: null, homeScore: null, status: 'scheduled',
      startTime: new Date(now.getTime() - 60 * 60 * 1_000),
      source: 'espn', fetchedAt: new Date(now.getTime() - 10 * 60 * 1_000),
    }])

    const result = await tryDeterministicAnswerDetailed('Are any college football games live currently?')

    expect(result?.kind).toBe('refusal')
    expect(result?.text).toContain('too old to say what is on right now')
    expect(result?.text).not.toContain('No live NCAAF games')
  })

  it('returns the next kickoff only after a fresh feed confirms no game is live', async () => {
    const now = new Date()
    mockSportsGameFindMany.mockResolvedValueOnce([{
      sport: 'NCAAF', externalId: 'espn-next', awayTeam: 'Ohio State', homeTeam: 'Texas',
      awayScore: null, homeScore: null, status: 'scheduled',
      startTime: new Date(now.getTime() + 60 * 60 * 1_000),
      source: 'espn', fetchedAt: new Date(now.getTime() - 30_000),
    }])

    const result = await tryDeterministicAnswerDetailed('Show me live college football games')

    expect(result?.kind).toBe('answer')
    expect(result?.text).toContain('No live NCAAF games are showing')
    expect(result?.text).toContain('Next scheduled:')
    expect(result?.text).toContain('Ohio State @ Texas')
  })
})

// ── checkScheduleContextAvailable ────────────────────────────────────────────

describe('checkScheduleContextAvailable', () => {
  it('returns true when DB has games today', async () => {
    mockCount.mockResolvedValue(5)

    const result = await checkScheduleContextAvailable()

    expect(result).toBe(true)
  })

  it('returns false when DB has no games today', async () => {
    mockCount.mockResolvedValue(0)

    const result = await checkScheduleContextAvailable()

    expect(result).toBe(false)
  })

  it('returns false on DB error (fail-safe)', async () => {
    mockCount.mockRejectedValue(new Error('DB offline'))

    const result = await checkScheduleContextAvailable()

    expect(result).toBe(false)
  })

  it('queries with a UTC daily window', async () => {
    mockCount.mockResolvedValue(0)

    await checkScheduleContextAvailable()

    expect(mockCount).toHaveBeenCalledOnce()
    const where = mockCount.mock.calls[0][0].where
    const { gte, lt } = where.startTime
    // Window spans exactly 24 hours
    expect(lt.getTime() - gte.getTime()).toBe(24 * 60 * 60 * 1_000)
    // dayStart is midnight UTC
    expect(gte.getUTCHours()).toBe(0)
    expect(gte.getUTCMinutes()).toBe(0)
    expect(gte.getUTCSeconds()).toBe(0)
  })
})

// ── tryDeterministicAnswer ────────────────────────────────────────────────────

describe('tryDeterministicAnswer', () => {
  it('returns refusal string for schedule question with no DB context', async () => {
    mockCount.mockResolvedValue(0)

    const result = await tryDeterministicAnswer('What games are on today?')

    expect(typeof result).toBe('string')
    expect(result!.length).toBeGreaterThan(10)
    expect(result).toContain("live schedule data")
  })

  it('returns null for schedule question when DB has games (pipeline should handle it)', async () => {
    mockCount.mockResolvedValue(3)

    const result = await tryDeterministicAnswer('What games are on today?')

    expect(result).toBeNull()
  })

  it('returns null for non-schedule questions without querying DB', async () => {
    const result = await tryDeterministicAnswer('What is my rank?')

    expect(result).toBeNull()
    expect(mockCount).not.toHaveBeenCalled()
  })

  it('returns null for "Explain my bracket" without querying DB', async () => {
    const result = await tryDeterministicAnswer('Explain my bracket.')

    expect(result).toBeNull()
    expect(mockCount).not.toHaveBeenCalled()
  })

  it('returns null for "Who should I start?" without querying DB', async () => {
    const result = await tryDeterministicAnswer('Who should I start this week?')

    expect(result).toBeNull()
    expect(mockCount).not.toHaveBeenCalled()
  })

  it('answers the World Cup start date without charging or calling AI', async () => {
    const result = await tryDeterministicAnswer('When does the World Cup start?')

    expect(result).toContain('June 11, 2026')
    expect(result).toContain('opening-match fixture cached')
  })

  it('answers a cached Knicks result from SportsGame rows', async () => {
    mockSportsGameFindMany.mockResolvedValueOnce([{
      sport: 'NBA',
      awayTeam: 'New York Knicks',
      homeTeam: 'Boston Celtics',
      awayScore: 101,
      homeScore: 99,
      status: 'Final',
      startTime: new Date('2026-06-05T23:30:00.000Z'),
    }])

    const result = await tryDeterministicAnswer('Did the Knicks win last night?')

    expect(result).toContain('Yes')
    expect(result).toContain('New York Knicks')
    expect(result).toContain('101-99')
    expect(result).toContain('cached SportsGame')
  })

  it('answers FantasyCalc trade value questions from the configured value feed', async () => {
    fetchFantasyCalcValuesMock.mockResolvedValueOnce([{
      player: { name: 'Patrick Mahomes', position: 'QB', maybeTeam: 'KC' },
      value: 6200,
      overallRank: 18,
      positionRank: 3,
      trend30Day: 120,
    }])

    const result = await tryDeterministicAnswer("What's the trade value on Patrick Mahomes?")

    expect(result).toContain("Patrick Mahomes")
    expect(result).toContain("6200")
    expect(result).toContain("FantasyCalc")
  })

  it('answers cached sports news without calling a paid model', async () => {
    getEnrichedNewsFeedMock.mockResolvedValueOnce([
      {
        headline: 'Chiefs update their depth chart',
        title: 'Chiefs update their depth chart',
        source: 'ESPN',
        publishedAt: '2026-06-06T12:00:00.000Z',
      },
    ])

    const result = await tryDeterministicAnswer('Any latest Chiefs news?')

    expect(result).toContain('Chiefs update their depth chart')
    expect(result).toContain('SportsNews cache')
    expect(getEnrichedNewsFeedMock).toHaveBeenCalledWith(expect.objectContaining({
      sport: 'NFL',
      refresh: false,
      enrich: false,
    }))
  })

  it('answers cached NFL weather from WeatherCache data', async () => {
    getCachedGameWeatherMock.mockResolvedValueOnce({
      venue: 'GEHA Field at Arrowhead Stadium',
      isDome: false,
      weather: {
        temp: 43,
        windSpeed: 17,
        description: 'light rain',
        fantasyImpact: 'Wind can reduce deep passing efficiency.',
      },
    })

    const result = await tryDeterministicAnswer('What is the weather for the Chiefs game?')

    expect(result).toContain('Kansas City Chiefs')
    expect(result).toContain('43F')
    expect(result).toContain('WeatherCache')
  })

  it('answers cached injury reports from SportsInjury rows', async () => {
    mockSportsInjuryFindMany.mockResolvedValueOnce([
      {
        playerName: 'Patrick Mahomes',
        team: 'KC',
        status: 'Questionable',
        description: 'Limited practice',
      },
    ])

    const result = await tryDeterministicAnswer('Patrick Mahomes injury update')

    expect(result).toContain('Patrick Mahomes')
    expect(result).toContain('Questionable')
    expect(result).toContain('SportsInjury cache')
  })

  /*
   * ⚠ BOTH HALVES ARE LOAD-BEARING AND THEY PULL IN OPPOSITE DIRECTIONS.
   *
   * The MISS half is the bug that was shipped: "live World Cup odds and
   * injuries" was answered "I do not have cached SOCCER injury data" — typed
   * `answer` — because the injury builder matched the word "injuries", missed,
   * and ended the dispatch before the unsupported-live-data refusal. Typed
   * `answer`, it also suppressed the live-search escalation at
   * app/api/chat/chimmy/route.ts:1413, which only ever fires on a `refusal`.
   *
   * The HIT half is the guard against the obvious-looking fix. Hoisting the
   * route's category check above these builders passes the MISS half and breaks
   * this one — and in production it would refuse "Any injuries on the Chiefs
   * playoff bracket?" with a World Cup line, because the router's `isWorldCup`
   * is `WORLD_CUP_RE || BRACKET_RE` and "bracket" alone satisfies it. Data from
   * our own rows wins on every route; only a miss yields.
   */
  it('yields a cached MISS to the unsupported-live-data refusal but never a cached HIT', async () => {
    mockSportsInjuryFindMany.mockResolvedValueOnce([
      {
        playerName: 'Kylian Mbappe',
        team: 'France',
        status: 'Questionable',
        description: 'Ankle knock',
      },
    ])

    const hit = await tryDeterministicAnswerDetailed('What are the live World Cup injuries right now?')

    expect(hit?.kind).toBe('answer')
    expect(hit?.text).toContain('Kylian Mbappe')
    expect(hit?.text).toContain('SportsInjury cache')

    mockSportsInjuryFindMany.mockResolvedValueOnce([])

    const miss = await tryDeterministicAnswerDetailed('What are the live World Cup injuries right now?')

    expect(miss?.kind).toBe('refusal')
    expect(miss?.text).toContain("I don't have fresh live provider data")
  })

  /*
   * ⚠ THE MISS CASE ON A MISROUTED QUESTION — the half the test above does not
   * cover, and the regression that shipped in 862fcd104 because of it.
   *
   * The router called this NFL question unsupported_live_data (BRACKET_RE alone
   * satisfied its isWorldCup), so the yield-on-miss guard fired and answered a
   * Chiefs injury question with "World Cup scoring rules, saved bracket picks,
   * pool standings". Nothing was charged and nothing was invented; it was simply
   * the wrong sport.
   *
   * Deliberately no assertion on `kind`. An empty NFL injury cache is currently
   * typed `answer`, which is the separate defect tracked for the nine
   * reliableUnavailable() misses — pinning it here would make this test fail
   * when that is fixed, for a reason that has nothing to do with what it guards.
   */
  it('answers a non-soccer bracket injury miss from the NFL cache, not with a World Cup refusal', async () => {
    mockSportsInjuryFindMany.mockResolvedValueOnce([])

    const result = await tryDeterministicAnswerDetailed('Any injuries on the Chiefs playoff bracket?')

    expect(result?.text).toContain('cached NFL injury data')
    expect(result?.text).not.toContain('fresh live provider data')
  })

  it('refuses exact stat-event questions when event data is unavailable', async () => {
    const result = await tryDeterministicAnswer('Who hit home runs across MLB yesterday?')

    expect(result).toContain("I don't have reliable data")
    expect(result).toContain('home runs')
    expect(result).toContain('not invent')
  })

  /*
   * ⚠ REGRESSION. "HRs" walked past the refusal and reached a model with no
   * baseball data behind it, because `\bhr\b` cannot match a plural. Nobody
   * types "HR" singular when asking who hit the most of them.
   */
  it('refuses the ABBREVIATED plural too, not just the spelled-out stat', async () => {
    for (const question of [
      'who hit the most HRs in the majors today?',
      'most HR in MLB today?',
      'how many RBIs did he have',
    ]) {
      const result = await tryDeterministicAnswer(question)
      expect(result, question).toContain("I don't have reliable data")
    }
  })

  it('still refuses a football stat question when the live feed is empty', async () => {
    readPlayByPlayFeedMock.mockResolvedValue([])

    const result = await tryDeterministicAnswer('How many TDs did Josh Allen have today?')

    expect(result).toContain("I don't have reliable data")
  })

  /*
   * A question about ONE player, which used to be refused while the answer sat
   * in the feed: the leader builder only fires on "most / top" phrasing, so
   * "how many TDs did X have" fell through to the blanket refusal.
   */
  const play = (over: Record<string, unknown> = {}) => ({
    gameId: 'g1',
    playerId: 'p-allen',
    playerName: 'Josh Allen',
    team: 'BUF',
    type: 'TOUCHDOWN',
    stat: 'rushing_touchdowns',
    delta: 1,
    value: 1,
    detectedAt: new Date('2026-08-27T23:30:00Z'),
    idempotencyKey: 'k1',
    detail: 'J.Allen 3 yd rush TOUCHDOWN',
    ...over,
  })

  it('answers with the total the feed actually holds', async () => {
    readPlayByPlayFeedMock.mockResolvedValue([
      play({ value: 1, idempotencyKey: 'k1' }),
      play({ value: 2, idempotencyKey: 'k2' }),
    ])

    const result = await tryDeterministicAnswer('How many TDs did Josh Allen have today?')

    expect(result).toContain('Josh Allen')
    expect(result).toContain('2')
    expect(result).toContain('touchdowns')
    expect(result).not.toContain("I don't have reliable data")
  })

  /* The window is at most a few hours; presenting it as a full day would lie. */
  it('says the number came from the live window, not a season total', async () => {
    readPlayByPlayFeedMock.mockResolvedValue([play()])

    const result = await tryDeterministicAnswer('how many touchdowns does Josh Allen have today')

    expect(result).toContain('live plays')
    expect(result).toMatch(/not a season total/i)
  })

  it('finds the player by surname when only one in the window carries it', async () => {
    readPlayByPlayFeedMock.mockResolvedValue([play({ value: 3 })])

    const result = await tryDeterministicAnswer('how many TDs did Allen have today?')

    expect(result).toContain('Josh Allen')
    expect(result).toContain('3')
  })

  /*
   * ⚠ THE IMPORTANT ONE. An absent player is NOT a zero — the window holds at
   * most 200 plays. Reporting "0 touchdowns" about a real player who simply is
   * not in it is the worst answer available, so this must refuse instead.
   */
  it('never reports a zero for a player it cannot see', async () => {
    readPlayByPlayFeedMock.mockResolvedValue([play()])

    const result = await tryDeterministicAnswer('How many TDs did Lamar Jackson have today?')

    expect(result).toContain("I don't have reliable data")
    expect(result).not.toContain('Lamar Jackson has 0')
    expect(result).not.toMatch(/\b0 touchdowns\b/)
  })

  /* Two named players is a comparison; guessing which one was meant is worse. */
  it('does not pick one of two named players', async () => {
    readPlayByPlayFeedMock.mockResolvedValue([
      play({ value: 2 }),
      play({ playerId: 'p-hurts', playerName: 'Jalen Hurts', team: 'PHI', value: 1 }),
    ])

    const result = await tryDeterministicAnswer(
      'how many TDs did Josh Allen and Jalen Hurts have today?',
    )

    expect(result).toContain("I don't have reliable data")
  })

  /* Leaderboard phrasing still belongs to the leader builder, not this one. */
  it('leaves "who has the most" to the leaderboard answer', async () => {
    readPlayByPlayFeedMock.mockResolvedValue([play({ value: 2 })])

    const result = await tryDeterministicAnswer('who has the most TDs today?')

    expect(result).toContain('Josh Allen')
    expect(result).toMatch(/leader|leads|most/i)
  })

  /*
   * ⚠ THE BIT THAT LETS A DEAD END BECOME A QUESTION SOMEBODY ELSE CAN ANSWER.
   * Both kinds used to come back as a bare string, so a caller holding "I have
   * no data" could not tell it apart from "here is the data" — and every
   * unanswerable sports question stopped there. Only a refusal may be looked up
   * elsewhere; an answer we can serve from our own rows must always win.
   */
  it('marks a data-backed reply as an answer and a no-data reply as a refusal', async () => {
    readPlayByPlayFeedMock.mockResolvedValue([play({ value: 2 })])
    const grounded = await tryDeterministicAnswerDetailed('how many TDs did Josh Allen have today?')
    expect(grounded?.kind).toBe('answer')
    expect(grounded?.text).toContain('Josh Allen')

    readPlayByPlayFeedMock.mockResolvedValue([])
    const empty = await tryDeterministicAnswerDetailed('who hit the most HRs in the majors today?')
    expect(empty?.kind).toBe('refusal')
    expect(empty?.text).toContain("I don't have reliable data")
  })

  /*
   * ⚠ EVERY "WE HAVE NOTHING" REPLY MUST BE TYPED `refusal`, NOT `answer`.
   *
   * Nine of the eleven such strings in deterministic.ts used to come back as `answer`,
   * because the builders return plain strings and the dispatcher wrapped every non-null
   * one identically. That is not cosmetic: app/api/chat/chimmy/route.ts escalates to the
   * citation-required live search ONLY on `kind === 'refusal'`, so a miss typed `answer`
   * is a dead end the caller cannot distinguish from data — which is the exact
   * distinction this result type exists to carry.
   *
   * Each row below is driven through a DIFFERENT builder, because the bug was per-builder
   * and a single representative case would have passed while eight others stayed broken.
   * The `answer` row at the end is the control: it fails if `classify` ever starts calling
   * everything a refusal, which would be the same bug with the sign flipped.
   */
  describe('a cache miss is a refusal, not an answer', () => {
    const prefix = "I don't have reliable data for that yet."

    it('types a cached INJURY miss as a refusal', async () => {
      mockSportsInjuryFindMany.mockResolvedValueOnce([])
      const r = await tryDeterministicAnswerDetailed('Any Chiefs injuries?')
      expect(r?.text.startsWith(prefix)).toBe(true)
      expect(r?.kind).toBe('refusal')
    })

    it('types a cached NEWS miss as a refusal', async () => {
      getEnrichedNewsFeedMock.mockResolvedValueOnce([])
      const r = await tryDeterministicAnswerDetailed('Any NFL news today?')
      expect(r?.text.startsWith(prefix)).toBe(true)
      expect(r?.kind).toBe('refusal')
    })

    it('types a cached WEATHER miss as a refusal', async () => {
      getCachedGameWeatherMock.mockResolvedValueOnce(null)
      const r = await tryDeterministicAnswerDetailed('What is the weather for the Chiefs game?')
      expect(r?.text.startsWith(prefix)).toBe(true)
      expect(r?.kind).toBe('refusal')
    })

    /*
     * This builder had NO locale parameter and its miss opened with its own sentence, so it
     * was invisible to the miss predicate however the dispatcher was written. Covered
     * explicitly because fixing the dispatcher alone would have left it an `answer`.
     */
    it('types a TEAM RESULT miss as a refusal', async () => {
      mockSportsGameFindMany.mockResolvedValue([])
      const r = await tryDeterministicAnswerDetailed('Did the Knicks win last night?')
      expect(r?.text.startsWith(prefix)).toBe(true)
      expect(r?.kind).toBe('refusal')
    })

    /* The control: real cached data must still be an answer. */
    it('still types a cached HIT as an answer', async () => {
      mockSportsInjuryFindMany.mockResolvedValueOnce([
        { playerName: 'Patrick Mahomes', team: 'KC', status: 'Questionable' },
      ])
      const r = await tryDeterministicAnswerDetailed('Any Chiefs injuries?')
      expect(r?.kind).toBe('answer')
      expect(r?.text).toContain('Patrick Mahomes')
    })
  })

  it('still returns null for a question it has no shortcut for', async () => {
    mockCount.mockResolvedValue(0)
    expect(await tryDeterministicAnswerDetailed('tell me a joke about punters')).toBeNull()
  })

  /* The string wrapper must stay behaviourally identical for its 4 callers. */
  it('keeps the string wrapper agreeing with the detailed result', async () => {
    readPlayByPlayFeedMock.mockResolvedValue([])
    const question = 'who hit the most HRs in the majors today?'

    expect(await tryDeterministicAnswer(question)).toBe(
      (await tryDeterministicAnswerDetailed(question))?.text,
    )
  })

  it('returns refusal (not null) when DB errors on schedule question (fail-safe)', async () => {
    // checkScheduleContextAvailable returns false on DB error,
    // so a schedule question with a DB error returns the refusal.
    mockCount.mockRejectedValue(new Error('DB offline'))

    const result = await tryDeterministicAnswer('Any games on tonight?')

    expect(typeof result).toBe('string')
  })

  // ── Locale-aware refusals ──────────────────────────────────────────────────

  it('returns English refusal when no locale is provided', async () => {
    mockCount.mockResolvedValue(0)
    const result = await tryDeterministicAnswer('What games are on today?')
    expect(result).toContain('live schedule data')
  })

  it('returns English refusal for explicit en locale', async () => {
    mockCount.mockResolvedValue(0)
    const result = await tryDeterministicAnswer('What games are on today?', 'en')
    expect(result).toContain('live schedule data')
  })

  it('returns Spanish refusal for es locale', async () => {
    mockCount.mockResolvedValue(0)
    const result = await tryDeterministicAnswer('What games are on today?', 'es')
    expect(result).not.toBeNull()
    expect(result).toContain('Necesito')
    expect(result).not.toContain('live schedule data')
  })

  it('returns Traditional Chinese refusal for zh locale', async () => {
    mockCount.mockResolvedValue(0)
    const result = await tryDeterministicAnswer('What games are on today?', 'zh')
    expect(result).not.toBeNull()
    expect(result).toContain('賽程')
    expect(result).not.toContain('live schedule data')
  })

  it('returns Filipino refusal for fil locale', async () => {
    mockCount.mockResolvedValue(0)
    const result = await tryDeterministicAnswer('What games are on today?', 'fil')
    expect(result).not.toBeNull()
    expect(result).toContain('iskedyul')
    expect(result).not.toContain('live schedule data')
  })

  it('returns Vietnamese refusal for vi locale', async () => {
    mockCount.mockResolvedValue(0)
    const result = await tryDeterministicAnswer('What games are on today?', 'vi')
    expect(result).not.toBeNull()
    expect(result).toContain('lịch')
    expect(result).not.toContain('live schedule data')
  })

  it('returns French refusal for fr locale', async () => {
    mockCount.mockResolvedValue(0)
    const result = await tryDeterministicAnswer('What games are on today?', 'fr')
    expect(result).not.toBeNull()
    expect(result).toContain('calendrier')
    expect(result).not.toContain('live schedule data')
  })

  it('returns Arabic refusal for ar locale', async () => {
    mockCount.mockResolvedValue(0)
    const result = await tryDeterministicAnswer('What games are on today?', 'ar')
    expect(result).not.toBeNull()
    expect(result).toContain('بيانات')
    expect(result).not.toContain('live schedule data')
  })

  it('falls back to English for unknown locale', async () => {
    mockCount.mockResolvedValue(0)
    const result = await tryDeterministicAnswer('What games are on today?', 'de')
    expect(result).toContain('live schedule data')
  })

  it('returns null (AI proceeds) regardless of locale when schedule data is available', async () => {
    mockCount.mockResolvedValue(5)
    const result = await tryDeterministicAnswer('What games are on today?', 'es')
    expect(result).toBeNull()
  })

  it('does not call DB for non-schedule question regardless of locale', async () => {
    const result = await tryDeterministicAnswer('Should I trade my RB?', 'es')
    expect(result).toBeNull()
    expect(mockCount).not.toHaveBeenCalled()
  })
})

// ── DETERMINISTIC_SOURCE marker ───────────────────────────────────────────────

describe('DETERMINISTIC_SOURCE', () => {
  it('is a non-empty string literal', () => {
    expect(typeof DETERMINISTIC_SOURCE).toBe('string')
    expect(DETERMINISTIC_SOURCE.length).toBeGreaterThan(0)
  })
})
