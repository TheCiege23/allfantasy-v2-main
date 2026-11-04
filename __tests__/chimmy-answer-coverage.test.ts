import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const { findMany, findFirst, resolveContext } = vi.hoisted(() => ({
  findMany: vi.fn(),
  findFirst: vi.fn(),
  resolveContext: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: { sportsGame: { findMany }, leagueStoryline: { findFirst } } }))
vi.mock('@/lib/league-context-engine', () => ({ resolveNormalizedLeagueContext: resolveContext }))

import { answerDatedGameQuestion } from '@/lib/chimmy/tools/datedGameAnswer'
import { buildRealGameResults } from '@/lib/chimmy/tools/realGameResults'
import { buildSelectedLeagueRules } from '@/lib/chimmy/tools/selectedLeagueRules'
import { requiresLeagueGrounding } from '@/lib/chimmy-chat/question-routing'
import { answerReadLeague } from '@/lib/chimmy/tools/answerReadLeague'

const now = new Date('2026-11-03T20:00:00Z')
const game = {
  homeTeam: 'Home', awayTeam: 'Away', startTime: new Date('2026-11-03T18:00:00Z'),
  homeScore: 0, awayScore: 0, status: 'IN2', fetchedAt: new Date('2026-11-03T19:30:00Z'),
  source: 'espn',
}

beforeEach(() => vi.resetAllMocks())

describe('Chimmy answer coverage', () => {
  it.each(['NFL', 'NCAAF', 'NBA', 'NCAAB', 'NHL', 'MLB', 'SOCCER'])('reads %s with bounded season and date filters', async (sport) => {
    findMany.mockResolvedValue([game, { ...game, source: 'other' }])
    const answer = await buildRealGameResults({ sport, season: 2026, date: '2026-11-03', team: 'Home' }, now)
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        sport: { equals: sport, mode: 'insensitive' },
        season: 2026,
        startTime: { not: null, gte: new Date('2026-11-03T00:00:00Z'), lt: new Date('2026-11-04T00:00:00Z') },
      }),
    }))
    expect(answer).toContain('last reported live; current status unverified')
    expect(answer).toContain('away 0, home 0')
    expect(answer).not.toContain('"source":"other"')
  })

  it('answers only the requested day and asks which club a partial name means', async () => {
    findMany.mockResolvedValue([])
    const missing = await answerDatedGameQuestion('What were the NBA scores on July 31, 2024?', 'NBA')
    expect(missing).toContain('2024-07-31 UTC. No stored games matched')
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      startTime: { not: null, gte: new Date('2024-07-31'), lt: new Date('2024-08-01') },
    }) }))
    findMany.mockResolvedValue([
      { ...game, homeTeam: 'Los Angeles Lakers' },
      { ...game, homeTeam: 'Los Angeles Clippers' },
    ])
    const ambiguous = await answerDatedGameQuestion('What were the NBA scores for Los Angeles on 2024-07-31?', 'NBA')
    expect(ambiguous).toContain('Los Angeles Lakers, Los Angeles Clippers')
    expect(ambiguous).toContain('Which full team name')
  })

  it('does not promote missing scores or invalid dates into results', async () => {
    expect(await buildRealGameResults({ sport: 'NBA', date: '2026-02-30' }, now)).toContain('invalid')
    expect(findMany).not.toHaveBeenCalled()
    findMany.mockResolvedValue([{ ...game, status: 'final', awayScore: null }])
    expect(await buildRealGameResults({ sport: 'NBA' }, now)).toContain('score unverified')
    expect(answerReadLeague(['get_real_game_results'])).toBe(false)
  })

  it('reads only the verified league season and keeps policy separate from settings', async () => {
    resolveContext.mockResolvedValue({
      ok: true,
      context: { leagueName: 'Friday League', sport: 'NFL', season: 2026, trade: { tradeDeadlineWeek: 10 }, importHealth: {} },
    })
    findFirst.mockResolvedValue({
      createdAt: now,
      metadata: { version: 2, sections: [{ id: 'trade', title: 'Trades', body: 'Trade deadline is week 9.' }] },
    })
    const answer = await buildSelectedLeagueRules('league-a', 'member')
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { leagueId: 'league-a', season: 2026, storyType: 'constitution' },
    }))
    expect(answer).toContain('"tradeDeadlineWeek":10')
    expect(answer).toContain('Trade deadline is week 9')
    expect(answer).toContain('Report conflicts explicitly')
  })

  it('reports verified native categories alongside the selected rules', async () => {
    resolveContext.mockResolvedValue({ ok: true, context: {
      leagueName: 'Category League', sport: 'NBA', season: 2026, importHealth: {},
      scoring: { scoringModel: 'unknown', rawSources: { settingsJson: {
        scoring_mode: 'h2h_category', category_preset_id: 'nba_9cat', category_record_mode: 'each',
      } } },
    } })
    findFirst.mockResolvedValue(null)
    const answer = await buildSelectedLeagueRules('league-a', 'member')
    expect(answer).toContain('"scoringModel":"category"')
    expect(answer).toContain('"presetId":"nba_9cat"')
    expect(answer).toContain('rate-stat denominators')
  })

  it('does not read a constitution without verified league access', async () => {
    resolveContext.mockResolvedValue({ ok: false })
    await buildSelectedLeagueRules('league-a', 'outsider')
    expect(findFirst).not.toHaveBeenCalled()
    expect(requiresLeagueGrounding({ message: 'What rules does our league use?', intent: 'general' })).toBe(true)
    expect(requiresLeagueGrounding({ message: 'What is category scoring?', intent: 'general' })).toBe(false)
  })
})
