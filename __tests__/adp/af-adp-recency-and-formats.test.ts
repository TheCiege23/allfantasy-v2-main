import { describe, expect, it } from 'vitest'

import { ADP_HALF_LIFE_DAYS, aggregateAdp, applyTrends, type AggregatablePick, type DraftContext } from '@/lib/adp/computeAllFantasyAdp'
import { buildDraftContext, isRookiePool, rosterFormatFromSettings } from '@/lib/adp/draftContextKey'

/**
 * AF ADP that moves with real drafts (owner's call, 2026-11-22: "if a player starts dropping in drafts, he doesn't have
 * the same ADP as he did before"). Recent picks weigh more, the 7 / 30-day trend is measured from the picks' own dates,
 * superflex and 1QB are separate boards, and rookie drafts never feed a startup board.
 */

const NOW = new Date('2026-11-22T12:00:00Z')
const DAY = 86_400_000
const CTX: DraftContext = { sport: 'NFL', leagueType: 'redraft', draftType: 'snake', scoringFormat: 'ppr', rosterFormat: 'standard', teamCount: 12, season: '2026' }
const pick = (overall: number, daysAgo: number | null): AggregatablePick => ({
  playerName: 'Slide Runner',
  position: 'RB',
  overall,
  round: Math.ceil(overall / 12),
  pickedAt: daysAgo == null ? null : new Date(NOW.getTime() - daysAgo * DAY),
  context: CTX,
  draftMode: 'real',
})

describe('recency', () => {
  it('a player sliding in recent drafts moves down at once — the old picks no longer hold him up', () => {
    // A month of drafts at pick 10, then this week's at 30.
    const picks = [...Array.from({ length: 20 }, (_, i) => pick(10, 30 + i)), ...Array.from({ length: 5 }, (_, i) => pick(30, i))]
    const [plain] = aggregateAdp(picks)
    const [recent] = aggregateAdp(picks, { now: NOW })
    expect(plain!.averageOverallPick).toBe(14) // the old plain mean barely moved
    expect(recent!.averageOverallPick).toBeGreaterThan(20)
    // The sample size is still the number of picks.
    expect(recent!.sampleSize).toBe(25)
  })

  it('a pick one half-life old counts half as much as one made today', () => {
    const [r] = aggregateAdp([pick(10, 0), pick(40, ADP_HALF_LIFE_DAYS)], { now: NOW })
    expect(r!.averageOverallPick).toBeCloseTo((10 * 1 + 40 * 0.5) / 1.5, 2)
  })

  it('undated picks (imported history) weigh the same as each other — the plain mean', () => {
    const [r] = aggregateAdp([pick(10, null), pick(30, null)], { now: NOW })
    expect(r!.averageOverallPick).toBe(20)
  })
})

describe('trends from the picks’ own dates', () => {
  it('sliding: negative; climbing: positive; nothing older than the window: null', () => {
    const slide = aggregateAdp([pick(10, 20), pick(10, 12), pick(30, 2), pick(30, 1)], { now: NOW })[0]!
    expect(slide.sevenDayTrend!).toBeLessThan(0)
    expect(slide.thirtyDayTrend).toBeNull()
    const climb = aggregateAdp([pick(40, 40), pick(40, 35), pick(15, 3), pick(15, 1)], { now: NOW })[0]!
    expect(climb.sevenDayTrend!).toBeGreaterThan(0)
    expect(climb.thirtyDayTrend!).toBeGreaterThan(0)
  })

  it('no new drafts since the window: no movement (0), not a phantom trend', () => {
    const still = aggregateAdp([pick(12, 20), pick(18, 15)], { now: NOW })[0]!
    expect(still.sevenDayTrend).toBe(0)
  })

  it('a measured trend is kept; a stored prior only fills a gap', () => {
    const measured = aggregateAdp([pick(10, 20), pick(30, 1)], { now: NOW })
    const key = `${measured[0]!.playerKey}::${measured[0]!.contextHash}::real`
    const out = applyTrends(measured, { sevenDay: new Map([[key, 99]]), thirtyDay: new Map([[key, 5]]) })[0]!
    expect(out.sevenDayTrend).toBe(measured[0]!.sevenDayTrend)
    expect(out.thirtyDayTrend).toBeCloseTo(5 - measured[0]!.averageOverallPick, 2)
  })
})

describe('separate boards', () => {
  const league = (settings: unknown, sport = 'NFL') => ({ sport, season: 2026, scoring: 'ppr', isDynasty: true, leagueVariant: null, leagueSize: 12, settings })

  it('superflex from every settings shape; 1QB when nothing says otherwise', () => {
    expect(rosterFormatFromSettings({ sportConfig: { enableSuperflex: true } })).toBe('superflex')
    expect(rosterFormatFromSettings({ roster_positions: ['QB', 'RB', 'SUPER_FLEX'] })).toBe('superflex')
    expect(rosterFormatFromSettings({ roster_positions: ['QB', 'QB', 'RB'] })).toBe('superflex')
    expect(rosterFormatFromSettings({ roster_format_type: '2QB' })).toBe('superflex')
    expect(rosterFormatFromSettings({ roster_positions: ['QB', 'RB', 'FLEX'] })).toBe('standard')
    expect(rosterFormatFromSettings(null)).toBe('standard')
  })

  it('the shared context carries it, for football only, and a caller’s explicit answer wins', () => {
    const sf = { roster_positions: ['QB', 'SUPER_FLEX'] }
    expect(buildDraftContext({ league: league(sf) }).rosterFormat).toBe('superflex')
    expect(buildDraftContext({ league: league(sf, 'NBA') }).rosterFormat).toBe('standard')
    expect(buildDraftContext({ league: league(null), superflex: true }).rosterFormat).toBe('superflex')
    expect(buildDraftContext({ league: league(sf), superflex: false }).rosterFormat).toBe('standard')
  })

  it('a rookies-only draft is its own board, so no rookie looks like a first-round startup pick', () => {
    expect(isRookiePool('rookies_only')).toBe(true)
    expect(isRookiePool('all')).toBe(false)
    expect(buildDraftContext({ league: league(null), session: { draftType: 'snake', teamCount: 12, playerPool: 'rookies_only' } }).leagueType).toBe('dynasty:rookie')
    expect(buildDraftContext({ league: league(null), session: { draftType: 'snake', teamCount: 12, playerPool: 'all' } }).leagueType).toBe('dynasty')
  })
})
