import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/chimmy/portfolio/data', () => ({ loadPortfolioTeam: vi.fn(), portfolioVersion: vi.fn(), unavailableTeam: (l: { id: string; name: string; sport: string; season: number }, reason: string) => ({ leagueId: l.id, leagueName: l.name, sport: l.sport, season: l.season, teamName: null, status: 'unavailable', stale: true, lastSyncedAt: null, rank: null, outOf: null, percentile: null, metrics: [], weakestPosition: null, gaps: [reason], actions: [] }) }))
vi.mock('@/lib/chimmy/tools/leagueByName', () => ({ listMemberLeagues: vi.fn() }))
import { clearPortfolioCache, preparePortfolioTurn, type PortfolioDeps } from '@/lib/chimmy/portfolio/service'
import { renderPortfolioAnswer } from '@/lib/chimmy/portfolio/render'
import { readPortfolioEvidence, type PortfolioTeam } from '@/lib/chimmy/portfolio/types'

const league = (id: string) => ({ id, name: 'League ' + id, sport: 'NFL', season: 2026 })
const team = (id: string, percentile = 80): PortfolioTeam => ({ leagueId: id, leagueName: 'League ' + id, sport: 'NFL', season: 2026, teamName: 'Own team', status: 'ready', stale: false, lastSyncedAt: '2026-11-04T12:00:00Z', rank: 3, outOf: 12, percentile, weakestPosition: 'RB', actions: [{ label: 'Find an upgrade', prompt: 'Find me a trade for RB in League ' + id }], gaps: [], metrics: [
  { key: 'strength', label: 'Strength', value: percentile, detail: '3 of 12 by league value' },
  { key: 'balance', label: 'Balance', value: 70, detail: 'RB 4 of 12' },
  { key: 'depth', label: 'Depth', value: 60, detail: '3 of 5 slots have a backup' },
] })
let deps: PortfolioDeps
beforeEach(() => {
  clearPortfolioCache()
  deps = { list: vi.fn().mockResolvedValue([league('a'), league('b')]), version: vi.fn().mockResolvedValue('v1'),
    read: vi.fn(async l => team(l.id, l.id === 'a' ? 90 : 60)), now: Date.now, budgetMs: 100, itemTimeoutMs: 30 }
})
afterEach(() => vi.useRealTimers())
const ask = (extra = {}) => preparePortfolioTurn({ userId: 'u1', question: 'Which league do I have the most complete team?', ...extra }, deps)

describe('portfolio service authorization and delivery', () => {
  it('answers Tommy’s wording from own member teams even with a league selected', async () => {
    const result = await ask({ selectedLeagueId: 'a' })
    expect(result?.kind).toBe('report')
    if (result?.kind !== 'report') throw Error('No report')
    expect(result.evidence.compared).toBe(2)
    expect(result.evidence.state.orderedLeagueIds).toEqual(['a', 'b'])
    expect(readPortfolioEvidence(result.evidence)).not.toBeNull()
    expect(renderPortfolioAnswer(result.evidence)).toContain('League a')
    expect(vi.mocked(deps.read).mock.calls.map(([l, userId]) => [l.id, userId])).toEqual([['a', 'u1'], ['b', 'u1']])
  })
  it('blocks without billing when no supported comparison exists', async () => {
    vi.mocked(deps.list).mockResolvedValue([])
    const result = await ask()
    expect(result?.kind === 'report' && result.evidence.status).toBe('blocked')
    if (result?.kind === 'report') expect(renderPortfolioAnswer(result.evidence)).toContain('not charged')
    expect(deps.read).not.toHaveBeenCalled()
  })
  it('returns partial evidence rather than losing good teams when another read fails', async () => {
    vi.mocked(deps.read).mockImplementation(async l => { if (l.id === 'b') throw Error('offline'); return team('a') })
    const result = await ask()
    if (result?.kind !== 'report') throw Error('No report')
    expect(result.evidence.status).toBe('partial')
    expect(result.evidence.compared).toBe(1)
    expect(result.evidence.teams.find(t => t.leagueId === 'b')?.status).toBe('unavailable')
  })
  it('resolves the ordinal follow-up to an authorized exact team without rescanning', async () => {
    const result = await ask({ question: 'Find an upgrade for the second one', previous: { version: 1, horizon: 'season', orderedLeagueIds: ['b', 'a'], focusLeagueId: 'b' } })
    expect(result?.kind === 'action' && result.leagueId).toBe('a')
    expect(deps.read).not.toHaveBeenCalled()
  })
  it('preserves actual named trade assets and the chosen scope', async () => {
    const result = await ask({ question: 'Find me a trade for RB in League b', selectedLeagueId: 'a', previous: { version: 1, horizon: 'season', orderedLeagueIds: ['a', 'b'], focusLeagueId: 'b' } })
    expect(result?.kind === 'action' && result.leagueId).toBe('b')
    expect(result?.kind === 'action' && result.question).toContain('trade for RB')
  })
  it('does not query another account’s ID supplied in reference state', async () => {
    const result = await ask({ question: 'Why that team?', previous: { version: 1, horizon: 'season', orderedLeagueIds: ['foreign'], focusLeagueId: 'foreign' } })
    expect(result?.kind === 'report' && result.evidence.status).toBe('blocked')
    expect(JSON.stringify(result)).not.toContain('foreign')
    expect(deps.read).not.toHaveBeenCalled()
  })
  it('bounds slow reads and names the unavailable team', async () => {
    vi.useFakeTimers()
    vi.mocked(deps.read).mockImplementation(l => l.id === 'a' ? Promise.resolve(team('a')) : new Promise(() => {}))
    const pending = ask()
    await vi.advanceTimersByTimeAsync(40)
    const result = await pending
    expect(result?.kind === 'report' && result.evidence.teams.find(t => t.leagueId === 'b')?.gaps.join(' ')).toMatch(/read budget/)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('allows the next pass to reach teams beyond the first forty', async () => {
    vi.mocked(deps.list).mockResolvedValue(Array.from({ length: 43 }, (_, i) => league(String(i))))
    const first = await ask()
    if (first?.kind !== 'report') throw Error('No report')
    expect(first.evidence.remaining).toBe(3)
    expect(first.evidence.total).toBe(43)
    const next = await ask({ question: 'Compare my remaining teams', previous: first.evidence.state })
    if (next?.kind !== 'report') throw Error('No next report')
    expect(next.evidence.teams.map(t => t.leagueId)).toEqual(['40', '41', '42'])
    expect(next.evidence.remaining).toBe(0)
  })
})

describe('portfolio snapshot cache', () => {
  it('rechecks membership on every hit while deduplicating reads', async () => {
    await ask(); await ask()
    expect(deps.list).toHaveBeenCalledTimes(2)
    expect(deps.read).toHaveBeenCalledTimes(2)
    vi.mocked(deps.list).mockResolvedValue([league('b')])
    const result = await ask()
    expect(result?.kind === 'report' && result.evidence.teams.map(t => t.leagueId)).toEqual(['b'])
  })
  it('separates users and horizons', async () => {
    await ask(); await ask({ userId: 'u2' }); await ask({ question: 'Compare my teams this week' })
    expect(deps.read).toHaveBeenCalledTimes(6)
  })
  it('invalidates after roster version changes and explicit refresh', async () => {
    await ask()
    vi.mocked(deps.version).mockResolvedValue('v2')
    await ask(); await ask({ refresh: true })
    expect(deps.read).toHaveBeenCalledTimes(6)
  })
  it('does not cache when the version read fails', async () => {
    vi.mocked(deps.version).mockRejectedValue(Error('offline'))
    await ask(); await ask()
    expect(deps.read).toHaveBeenCalledTimes(4)
  })
  it('shares concurrent requests for the same own-team snapshot', async () => {
    await Promise.all([ask(), ask()])
    expect(deps.read).toHaveBeenCalledTimes(2)
  })
})


describe('partial analysis and injury exposure', () => {
  it('still answers from verified roster structure when strength values are unavailable', async () => {
    vi.mocked(deps.read).mockImplementation(async l => ({ ...team(l.id), status: 'partial', rank: null, outOf: null, percentile: null, gaps: ['Values unavailable'] }))
    const result = await ask()
    if (result?.kind !== 'report') throw Error('No report')
    expect(result.evidence.status).toBe('partial')
    expect(result.evidence.compared).toBe(2)
    expect(renderPortfolioAnswer(result.evidence)).toContain('only verified coverage and depth')
  })
  it('counts verified own holdings for a named injury even without a current injury feed', async () => {
    vi.mocked(deps.read).mockImplementation(async l => ({ ...team(l.id), rosterNames: ['Josh Allen'] }))
    const result = await ask({ question: 'How many teams would Josh Allen injury affect?' })
    if (result?.kind !== 'report') throw Error('No report')
    expect(result.evidence.focusPlayer).toBe('Josh Allen')
    expect(renderPortfolioAnswer(result.evidence)).toContain('Josh Allen appears on 2 compared own team(s)')
  })
  it('asks which player instead of guessing what this injury refers to', async () => {
    const result = await ask({ question: 'How many teams would this injury affect?' })
    expect(result?.kind === 'report' && result.evidence.status).toBe('blocked')
  })
  it('keeps the previous multi-league scope when changing horizon from a selected league page', async () => {
    const result = await ask({ question: 'What about dynasty?', selectedLeagueId: 'a', previous: { version: 1, horizon: 'season', orderedLeagueIds: ['a','b'], scopeLeagueIds: ['a','b'], focusLeagueId: 'a' } })
    expect(result?.kind === 'report' && result.evidence.total).toBe(2)
    expect(vi.mocked(deps.read).mock.calls.every(([, , horizon]) => horizon === 'dynasty')).toBe(true)
  })
})
