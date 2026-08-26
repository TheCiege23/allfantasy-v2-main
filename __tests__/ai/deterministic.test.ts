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

import { prisma } from '@/lib/prisma'
import {
  detectScheduleQuestion,
  checkScheduleContextAvailable,
  tryDeterministicAnswer,
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

  it('refuses exact stat-event questions when event data is unavailable', async () => {
    const result = await tryDeterministicAnswer('Who hit home runs across MLB yesterday?')

    expect(result).toContain("I don't have reliable data")
    expect(result).toContain('home runs')
    expect(result).toContain('not invent')
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
