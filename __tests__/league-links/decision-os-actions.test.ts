// @vitest-environment node
/**
 * Decision OS action loop (server enricher): the external source-platform action is resolved SERVER-SIDE
 * from the CANONICAL League row — never from a URL carried by the item, a cached payload, or the client.
 * Covers Sleeper/ESPN/Yahoo, fallback + unknown + missing platform, malicious/stale URL rejection,
 * cross-league isolation, informational (no external CTA), read-only disclosure, internal-action
 * availability, manager-scope preservation, and no provider fetch.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ findMany: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findMany: h.findMany } } }))

import { enrichLineupActionsWithLinks } from '@/lib/league-links/enrichDecisionOsActions'
import type { LineupActionItem } from '@/lib/lineup-actions/types'

function item(over: Partial<LineupActionItem>): LineupActionItem {
  return {
    leagueId: 'L1', leagueName: 'HailShiva', sport: 'NFL' as never, platform: 'sleeper',
    teamId: null, slotIndex: null, slotId: null, slotLabel: null, playerId: null, playerName: null,
    reasonType: 'empty_starter', urgency: 'urgent', lockTime: null, recommendedAction: 'Fix your lineup',
    suggestedReplacementPlayerId: null, confidence: null, expectedGain: null, sourceModule: 'lineup_scan',
    message: 'x', severity: 'critical', ...over,
  }
}
const league = (over: Record<string, unknown> = {}) => ({
  id: 'L1', platform: 'sleeper', platformLeagueId: '131353', name: 'HailShiva', season: 2026,
  lastSyncedAt: new Date('2026-07-28T12:00:00.000Z'), ...over,
})

beforeEach(() => vi.clearAllMocks())

describe('enrichLineupActionsWithLinks', () => {
  it('Sleeper lineup → direct league URL + "Set Lineup" + internal AF action + freshness (imported)', async () => {
    h.findMany.mockResolvedValue([league()])
    const [out] = await enrichLineupActionsWithLinks([item({ reasonType: 'empty_starter' })])
    expect(out.actionLinks?.external?.link.href).toBe('https://sleeper.com/leagues/131353/league')
    expect(out.actionLinks?.external?.label).toBe('Set Lineup in HailShiva')
    expect(out.actionLinks?.internal).toEqual({ href: '/league/L1?tab=team', label: 'Review Lineup in AF' })
    expect(out.actionLinks?.imported).toBe(true)
    expect(out.actionLinks?.dataAsOf).toBe('2026-07-28T12:00:00.000Z')
  })

  it('ESPN waiver → ESPN league URL + "Manage Waivers" + players tab', async () => {
    h.findMany.mockResolvedValue([league({ platform: 'espn', platformLeagueId: '42654852' })])
    const [out] = await enrichLineupActionsWithLinks([item({ reasonType: 'ai_waiver', platform: 'espn' })])
    expect(out.actionLinks?.external?.link.href).toBe('https://fantasy.espn.com/football/league?leagueId=42654852&seasonId=2026')
    expect(out.actionLinks?.external?.label).toBe('Manage Waivers in HailShiva')
    expect(out.actionLinks?.internal?.href).toBe('/league/L1?tab=players')
  })

  it('Yahoo injury → Yahoo league URL + "Manage Roster"', async () => {
    h.findMany.mockResolvedValue([league({ platform: 'yahoo', platformLeagueId: '12798' })])
    const [out] = await enrichLineupActionsWithLinks([item({ reasonType: 'injury_impact', platform: 'yahoo' })])
    expect(out.actionLinks?.external?.link.href).toBe('https://football.fantasysports.yahoo.com/f1/12798')
    expect(out.actionLinks?.external?.label).toBe('Manage Roster in HailShiva')
  })

  it('MFL (fallback platform) → approved homepage, still imported', async () => {
    h.findMany.mockResolvedValue([league({ platform: 'mfl', platformLeagueId: '999' })])
    const [out] = await enrichLineupActionsWithLinks([item({ reasonType: 'empty_starter', platform: 'mfl' })])
    expect(out.actionLinks?.external?.link.href).toBe('https://www.myfantasyleague.com')
    expect(out.actionLinks?.external?.link.isFallback).toBe(true)
    expect(out.actionLinks?.imported).toBe(true)
  })

  it('native/unknown platform → NO external action (internal AF action still offered)', async () => {
    h.findMany.mockResolvedValue([league({ platform: 'allfantasy', platformLeagueId: null })])
    const [out] = await enrichLineupActionsWithLinks([item({ reasonType: 'empty_starter', platform: 'allfantasy' })])
    expect(out.actionLinks?.external).toBeNull()
    expect(out.actionLinks?.imported).toBe(false)
    expect(out.actionLinks?.internal?.label).toBe('Review Lineup in AF')
  })

  it('missing league record → fails safe (no external, not imported)', async () => {
    h.findMany.mockResolvedValue([]) // not found
    const [out] = await enrichLineupActionsWithLinks([item({ leagueId: 'GONE' })])
    expect(out.actionLinks?.external).toBeNull()
    expect(out.actionLinks?.imported).toBe(false)
  })

  it('IGNORES a malicious / stale URL carried on the item — resolves ONLY from the canonical league', async () => {
    h.findMany.mockResolvedValue([league()])
    const malicious = item({ reasonType: 'empty_starter' }) as LineupActionItem & Record<string, string>
    malicious.url = 'javascript:alert(1)'
    malicious.sourceUrl = 'https://evil.com/steal'
    malicious.storedUrl = 'https://sleeper.com.evil.com/x'
    const [out] = await enrichLineupActionsWithLinks([malicious])
    expect(out.actionLinks?.external?.link.href).toBe('https://sleeper.com/leagues/131353/league')
  })

  it('cross-league isolation — each item gets ONLY its own league URL', async () => {
    h.findMany.mockResolvedValue([
      { id: 'A', platform: 'sleeper', platformLeagueId: '111', name: 'A', season: 2026, lastSyncedAt: null },
      { id: 'B', platform: 'espn', platformLeagueId: '222', name: 'B', season: 2026, lastSyncedAt: null },
    ])
    const out = await enrichLineupActionsWithLinks([
      item({ leagueId: 'A', leagueName: 'A' }),
      item({ leagueId: 'B', leagueName: 'B', platform: 'espn' }),
    ])
    expect(out[0].actionLinks?.external?.link.href).toBe('https://sleeper.com/leagues/111/league')
    expect(out[1].actionLinks?.external?.link.href).toBe('https://fantasy.espn.com/football/league?leagueId=222&seasonId=2026')
  })

  it('informational signals → NO external CTA; matchup keeps internal, weather/fetch_error are pure info', async () => {
    h.findMany.mockResolvedValue([league()])
    const out = await enrichLineupActionsWithLinks([
      item({ reasonType: 'matchup_prep' }),
      item({ reasonType: 'weather_risk' }),
      item({ reasonType: 'fetch_error' }),
    ])
    expect(out[0].actionLinks?.actionable).toBe(false)
    expect(out[0].actionLinks?.external).toBeNull()
    expect(out[0].actionLinks?.internal?.label).toBe('Review Matchup in AF')
    expect(out[1].actionLinks?.external).toBeNull()
    expect(out[1].actionLinks?.internal).toBeNull()
    expect(out[2].actionLinks?.external).toBeNull()
    expect(out[2].actionLinks?.internal).toBeNull()
  })

  it('preserves the original item fields (manager scope untouched) and adds only actionLinks', async () => {
    h.findMany.mockResolvedValue([league()])
    const [out] = await enrichLineupActionsWithLinks([item({ reasonType: 'ai_start_sit', teamId: 'T9', playerId: 'P1', urgency: 'soon' })])
    expect(out).toMatchObject({ leagueId: 'L1', teamId: 'T9', playerId: 'P1', reasonType: 'ai_start_sit', urgency: 'soon' })
    expect(out.actionLinks).toBeDefined()
  })

  it('does NOT fetch a provider during resolution', async () => {
    h.findMany.mockResolvedValue([league()])
    const spy = vi.spyOn(globalThis, 'fetch' as never)
    await enrichLineupActionsWithLinks([item({})])
    expect(spy).not.toHaveBeenCalled()
  })

  it('empty input → no DB call', async () => {
    const out = await enrichLineupActionsWithLinks([])
    expect(out).toEqual([])
    expect(h.findMany).not.toHaveBeenCalled()
  })
})
