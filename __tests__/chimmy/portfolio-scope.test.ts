import { describe, expect, it } from 'vitest'
import { portfolioLeagues, portfolioRequest, selectPortfolioScope } from '@/lib/chimmy/portfolio/scope'
import { readPortfolioEvidence, readPortfolioState } from '@/lib/chimmy/portfolio/types'
import { constructionIndex, leaguePercentile, orderPortfolioTeams, rosterStructure } from '@/lib/chimmy/portfolio/metrics'
import type { PortfolioState, PortfolioTeam } from '@/lib/chimmy/portfolio/types'

const leagues = [
  { id: 'a', name: 'KBFL', sport: 'NFL', season: 2026 },
  { id: 'b', name: 'Draft Junkies', sport: 'NFL', season: 2025 },
  { id: 'c', name: 'Hoop Crew', sport: 'NBA', season: 2026 },
]
const previous: PortfolioState = { version: 1, horizon: 'season', orderedLeagueIds: ['b', 'a', 'c'], focusLeagueId: 'b' }

describe('portfolio question scope', () => {
  it.each([
    'Which league do I have the most complete team?', 'Compare my teams', 'Rank my rosters by depth',
    'Which of my teams needs attention first?', 'Which team is strongest?', 'Compare my teams for dynasty outlook',
    'Which team has the best championship chance?', "Who's hurt across my teams?", 'Review my roster',
  ])('understands %s', q => expect(portfolioRequest(q)).not.toBeNull())
  it.each(['What is PPR?', 'Who won the NBA championship?', 'Who has the strongest NFL team?', 'Should I trade Josh Allen for Lamar Jackson?'])('does not take over %s', q => expect(portfolioRequest(q)).toBeNull())
  it('keeps one selected team for a singular roster review', () => {
    const request = portfolioRequest('Review my roster')!
    expect(selectPortfolioScope({ leagues, question: 'Review my roster', request, selectedLeagueId: 'a' }).leagues.map(l => l.id)).toEqual(['a'])
  })
  it('uses all teams for an explicit comparison even when a league is selected', () => {
    const request = portfolioRequest('Compare my teams')!
    expect(selectPortfolioScope({ leagues, question: 'Compare my teams', request, selectedLeagueId: 'a' }).leagues).toEqual(leagues)
  })
  it('resolves two named member leagues without adding a third', () => {
    const request = portfolioRequest('Compare my teams in KBFL and Draft Junkies')!
    expect(selectPortfolioScope({ leagues, question: 'Compare my teams in KBFL and Draft Junkies', request }).leagues.map(l => l.id)).toEqual(['a', 'b'])
  })
  it('resolves the second team from the previous comparison, not current sort order', () => {
    const q = 'Find an upgrade for the second one'
    const selected = selectPortfolioScope({ leagues, question: q, request: portfolioRequest(q, previous)!, previous })
    expect(selected.focusLeagueId).toBe('a')
    expect(portfolioRequest(q, previous)?.action).toBe('trade')
  })
  it('refuses a removed referenced team instead of shifting another team into its position', () => {
    const q = 'Explain the second one'
    const selected = selectPortfolioScope({ leagues: leagues.filter(l => l.id !== 'a'), question: q, request: portfolioRequest(q, previous)!, previous })
    expect(selected.ambiguous).toBe(true)
    expect(selected.focusLeagueId).toBeNull()
  })
  it('drops foreign IDs before any read or returned scope state', () => {
    const q = 'Why that team?'
    const selected = selectPortfolioScope({ leagues, question: q, request: portfolioRequest(q, previous)!, previous: { ...previous, orderedLeagueIds: ['secret'], focusLeagueId: 'secret' } })
    expect(selected.prior?.orderedLeagueIds).toEqual([])
    expect(selected.focusLeagueId).toBeNull()
    expect(selected.ambiguous).toBe(true)
  })
  it('changes horizon explicitly and inherits it for explanations', () => {
    expect(portfolioRequest('What about dynasty?', previous)?.horizon).toBe('dynasty')
    expect(portfolioRequest('Compare my teams this week', previous)?.horizon).toBe('week')
    expect(portfolioRequest('Why that team?', { ...previous, horizon: 'week' })?.horizon).toBe('week')
  })
  it('does not hijack an unrelated follow-up question', () => {
    expect(portfolioRequest('Why do NFL teams use a nickel defense?', previous)).toBeNull()
  })
  it('keeps an older active league when another league imports a newer season', () => {
    expect(portfolioLeagues(leagues, 'Compare my teams').map(l => l.id)).toEqual(['a', 'b', 'c'])
  })
  it('excludes explicitly completed leagues unless that historical year was requested', () => {
    const input = [...leagues, { ...leagues[0]!, id: 'old', season: 2024, status: 'complete' }]
    expect(portfolioLeagues(input, 'Compare my teams').map(l => l.id)).not.toContain('old')
    expect(portfolioLeagues(input, 'Compare my 2024 teams').map(l => l.id)).toEqual(['old'])
  })
  it('collapses only proven same-provider league identity, not league names', () => {
    const input = [
      { ...leagues[0]!, platform: 'sleeper', platformLeagueId: 'p' },
      { ...leagues[0]!, id: 'older', season: 2025, platform: 'sleeper', platformLeagueId: 'p' },
      { ...leagues[0]!, id: 'other', platform: 'espn', platformLeagueId: 'p' },
    ]
    expect(portfolioLeagues(input, 'Compare my teams').map(l => l.id)).toEqual(['a', 'other'])
  })
})

describe('comparison metrics', () => {
  it('normalizes rank against each league size', () => {
    expect(leaguePercentile(1, 8)).toBe(100)
    expect(leaguePercentile(1, 16)).toBe(100)
    expect(leaguePercentile(12, 12)).toBe(0)
    expect(leaguePercentile(1, 1)).toBeNull()
  })
  it('does not count IR or taxi as active depth and never double-assigns a player', () => {
    const metrics = rosterStructure(['QB', 'SUPER_FLEX'], [
      { id: 'q', position: 'QB', reserve: false }, { id: 'r', position: 'RB', reserve: false },
      { id: 'taxi', position: 'QB', reserve: true },
    ])
    expect(metrics.find(m => m.key === 'slots')?.value).toBe(100)
    expect(metrics.find(m => m.key === 'depth')?.value).toBe(0)
  })
  it('withholds unknown eligibility instead of guessing a lineup', () => {
    expect(rosterStructure(['MYSTERY'], [])[0]?.value).toBeNull()
    expect(rosterStructure(null, [])[0]?.value).toBeNull()
  })
  it('handles overlapping flex slots with a complete matching', () => {
    const metrics = rosterStructure(['FLEX', 'WRRB_FLEX', 'TE'], [
      { id: 'te', position: 'TE', reserve: false }, { id: 'r', position: 'RB', reserve: false }, { id: 'w', position: 'WR', reserve: false },
    ])
    expect(metrics.find(m => m.key === 'slots')?.value).toBe(100)
  })
  const team = (leagueId: string, sport = 'NFL'): PortfolioTeam => ({ leagueId, leagueName: leagueId, sport, season: 2026,
    teamName: null, status: 'ready', stale: false, lastSyncedAt: null, rank: 1, outOf: 12, percentile: 100,
    weakestPosition: null, actions: [], gaps: [], metrics: [{ key: 'balance', value: 50, label: '', detail: '' }, { key: 'depth', value: 50, label: '', detail: '' }] })
  it('exposes the construction weights and withholds incomplete or stale scores', () => {
    expect(constructionIndex(team('a'))).toBe(75)
    expect(constructionIndex({ ...team('a'), stale: true })).toBeNull()
    expect(constructionIndex({ ...team('a'), metrics: [] })).toBeNull()
  })
  it('groups sports rather than picking an overall NBA/NFL winner', () => {
    const ordered = orderPortfolioTeams([team('a'), team('b', 'NBA'), team('c')], false)
    expect(ordered.map(t => t.sport)).toEqual(['NBA', 'NFL', 'NFL'])
  })
})

describe('portfolio state parsing', () => {
  it('rejects oversized or malformed state', () => {
    expect(readPortfolioState('not json')).toBeNull()
    expect(readPortfolioState({ ...previous, horizon: 'forever' })).toBeNull()
    expect(readPortfolioState({ ...previous, orderedLeagueIds: Array(401).fill('a') })).toBeNull()
    expect(readPortfolioEvidence({ version: 1 })).toBeNull()
  })
})
