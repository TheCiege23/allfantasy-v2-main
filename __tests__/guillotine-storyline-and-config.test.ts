import { describe, it, expect, vi, beforeEach } from 'vitest'

import { getGuillotineSportConfig } from '@/lib/guillotine/sportConfig'
import { getGuillotineConfig } from '@/lib/guillotine/GuillotineLeagueConfig'
import {
  generateWeeklyGuillotineRecap,
  generateEliminationPage,
  generateChopWeekWaiverRecap,
  generateFinalStagePreview,
} from '@/lib/guillotine/ai/storylineGenerator'

const prismaMock = vi.hoisted(() => ({
  league: {
    findUnique: vi.fn(),
  },
  guillotineLeagueConfig: {
    findUnique: vi.fn(),
  },
  guillotineSeason: {
    findFirst: vi.fn(),
  },
  guillotineElimination: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
  },
  guillotineSurvivalLog: {
    findMany: vi.fn(),
  },
  guillotineWaiverRelease: {
    findMany: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

describe('Guilly config and storyline gaps', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('default elimination end week aligns with sport regular season when using fallback league settings', async () => {
    for (const sport of ['NFL', 'NBA', 'NHL', 'MLB', 'NCAAF', 'NCAAB', 'SOCCER'] as const) {
      prismaMock.league.findUnique.mockResolvedValueOnce({
        id: 'league-1',
        sport,
        leagueVariant: 'guillotine',
        settings: {},
      })
      prismaMock.guillotineLeagueConfig.findUnique.mockResolvedValueOnce(null)

      const cfg = await getGuillotineConfig('league-1')
      expect(cfg).not.toBeNull()
      expect(cfg!.eliminationEndWeek).toBe(getGuillotineSportConfig(sport)?.regularSeasonWeeks)
    }
  })

  it('weekly recap uses real elimination and danger data (no placeholder text)', async () => {
    prismaMock.guillotineSeason.findFirst.mockResolvedValue({
      league: { name: 'Blade City' },
    })
    prismaMock.guillotineElimination.findMany.mockResolvedValue([
      { eliminatedTeamName: 'Team Chop' },
    ])
    prismaMock.guillotineSurvivalLog.findMany.mockResolvedValue([
      { rosterId: 'roster-danger' },
    ])

    const story = await generateWeeklyGuillotineRecap('season-1', 5)
    expect(story.body).toContain('Team Chop got chopped')
    expect(story.body).toContain('roster-danger')
    expect(story.body.toLowerCase()).not.toContain('pending score feed')
  })

  it('elimination page includes concrete elimination details', async () => {
    prismaMock.guillotineElimination.findFirst.mockResolvedValue({
      eliminatedTeamName: 'Team Last',
      scoringPeriod: 6,
      finalScore: 81.23,
      marginBelowSafe: -2.75,
      aiCollapseReason: 'Injuries and bench zeros',
    })

    const story = await generateEliminationPage('elim-1')
    expect(story.headline).toContain('Team Last')
    expect(story.body).toContain('81.23 points')
    expect(story.body).toContain('2.75 points separated')
    expect(story.body).toContain('Injuries and bench zeros')
  })

  it('waiver war recap reflects claimed vs pending state and top bid', async () => {
    prismaMock.guillotineWaiverRelease.findMany.mockResolvedValue([
      { playerName: 'Player A', releaseStatus: 'claimed', claimedByRosterId: 'r1', winningBid: 42 },
      { playerName: 'Player B', releaseStatus: 'pending', claimedByRosterId: null, winningBid: null },
    ])

    const story = await generateChopWeekWaiverRecap('season-1', 7)
    expect(story.body).toContain('1 players were claimed and 1 remain available')
    expect(story.body).toContain('Player A for $42')
  })

  it('final stage preview uses current standings and final-stage flag', async () => {
    prismaMock.guillotineSeason.findFirst.mockResolvedValue({
      currentScoringPeriod: 8,
      isInFinalStage: true,
      league: { name: 'Blade City' },
    })
    prismaMock.guillotineSurvivalLog.findMany.mockResolvedValue([
      { rosterId: 'r1', rankAmongActive: 1 },
      { rosterId: 'r2', rankAmongActive: 2 },
    ])

    const story = await generateFinalStagePreview('season-1')
    expect(story.headline).toContain('Blade City')
    expect(story.body).toContain('entered final-stage survival mode')
    expect(story.body).toContain('#1 r1')
    expect(story.body).toContain('#2 r2')
  })
})
