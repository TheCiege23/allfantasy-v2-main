import { describe, expect, it, beforeEach, vi } from 'vitest'
import type { LeagueCreationAnalyticsEvent, LeagueCreationAnalyticsTransport } from '@/lib/analytics/league-creation/types'
import { compactLeagueCreationAnalyticsEvent, classifyValidationFrictionKind } from '@/lib/analytics/league-creation/normalize'
import {
  resetLeagueCreationAnalyticsSession,
  setLeagueCreationAnalyticsTransport,
  trackLeagueCreationEvent,
  touchLeagueCreationAnalyticsMode,
} from '@/lib/analytics/league-creation/track'
import { tryConsumeLeagueCreateStartedAnalyticsSlot } from '@/lib/analytics/league-creation/session'
import { hydrateCreateLeagueInitialState } from '@/lib/create-league-v2/create-league-initial-hydration'

function collectTransport(): { events: LeagueCreationAnalyticsEvent[]; transport: LeagueCreationAnalyticsTransport } {
  const events: LeagueCreationAnalyticsEvent[] = []
  return {
    events,
    transport: {
      send: (e) => {
        events.push(e)
      },
    },
  }
}

describe('league creation analytics (Phase 4A)', () => {
  beforeEach(() => {
    resetLeagueCreationAnalyticsSession()
    setLeagueCreationAnalyticsTransport(null)
  })

  it('emits events through a mock transport', () => {
    const { events, transport } = collectTransport()
    setLeagueCreationAnalyticsTransport(transport)
    trackLeagueCreationEvent('league_create_started', { createMode: 'quick', sport: 'NFL' })
    expect(events).toHaveLength(1)
    expect(events[0].name).toBe('league_create_started')
    expect(events[0].sport).toBe('NFL')
    expect(typeof events[0].sessionId).toBe('string')
    expect(typeof events[0].timestamp).toBe('number')
  })

  it('compactLeagueCreationAnalyticsEvent removes undefined keys', () => {
    const e = trackLeagueCreationEvent('league_create_mode_selected', { createMode: 'advanced' })
    const c = compactLeagueCreationAnalyticsEvent(e)
    expect('previousMode' in c).toBe(false)
    expect(c.name).toBe('league_create_mode_selected')
  })

  it('classifies validation friction buckets from issue codes', () => {
    expect(classifyValidationFrictionKind(['concept_required'])).toBe('missing_required')
    expect(classifyValidationFrictionKind(['scoring_invalid'])).toBe('invalid_combination')
    expect(classifyValidationFrictionKind(['dynasty_faab'])).toBe('unsupported_settings')
  })

  it('records AI unsupported request side-event shape', () => {
    const { events, transport } = collectTransport()
    setLeagueCreationAnalyticsTransport(transport)
    trackLeagueCreationEvent('league_create_ai_unsupported_requests', { aiUnsupportedRequestCount: 2 })
    expect(events[0].aiUnsupportedRequestCount).toBe(2)
  })

  it('records create success and failure payloads', () => {
    const { events, transport } = collectTransport()
    setLeagueCreationAnalyticsTransport(transport)
    const state = hydrateCreateLeagueInitialState(null, 'quick')
    trackLeagueCreationEvent('league_create_succeeded', {
      createMode: 'quick',
      sport: state.sport,
      leagueType: 'redraft',
      success: true,
    })
    trackLeagueCreationEvent('league_create_failed', {
      createMode: 'quick',
      sport: state.sport,
      success: false,
      failureReason: 'network',
      errorClass: 'exception',
    })
    expect(events[1].success).toBe(false)
    expect(events[1].failureReason).toBe('network')
  })

  it('touchLeagueCreationAnalyticsMode reports duration when switching modes', () => {
    resetLeagueCreationAnalyticsSession()
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    touchLeagueCreationAnalyticsMode('quick')
    vi.setSystemTime(1_000_000 + 30_000)
    const t = touchLeagueCreationAnalyticsMode('templates')
    expect(t.previousMode).toBe('quick')
    expect(t.previousModeDurationMs).toBe(30_000)
    vi.useRealTimers()
  })

  it('dedupes league create started slot until session reset', () => {
    resetLeagueCreationAnalyticsSession()
    expect(tryConsumeLeagueCreateStartedAnalyticsSlot()).toBe(true)
    expect(tryConsumeLeagueCreateStartedAnalyticsSlot()).toBe(false)
    resetLeagueCreationAnalyticsSession()
    expect(tryConsumeLeagueCreateStartedAnalyticsSlot()).toBe(true)
  })
})
