import { describe, expect, it } from 'vitest'
import { toDecisionEvent, type DecisionEvent } from '../events/types'
import * as DecisionOSCore from '../index'
import {
  makeSystemProvenance,
  makeMinUncertainty,
} from '@/lib/decision-os/behavioral/events/types'

function sampleEvent(): DecisionEvent {
  return {
    eventId: 'evt-1',
    eventType: 'lineup_saved',
    occurredAt: '2026-09-08T17:00:00.000Z',
    recordedAt: '2026-09-08T17:00:01.000Z',
    leagueId: 'league-1',
    managerId: 'user-1',
    source: 'api',
    provenance: makeSystemProvenance(['RedraftRoster']),
    completeness: 100,
    uncertainty: makeMinUncertainty(),
    metadata: {
      week: 1,
      season: 2026,
      leagueType: 'redraft',
      slotChanges: 2,
      startedPlayerIds: ['p1'],
      benchedPlayerIds: ['p2'],
    },
  }
}

describe('DecisionEvent (public alias of BehavioralEvent)', () => {
  it('round-trips a BehavioralEvent-shaped value unchanged through toDecisionEvent', () => {
    const event = sampleEvent()
    expect(toDecisionEvent(event)).toBe(event)
  })

  it('preserves discriminated-union narrowing on eventType', () => {
    const event = sampleEvent()
    if (event.eventType === 'lineup_saved') {
      expect(event.metadata.slotChanges).toBe(2)
    } else {
      throw new Error('expected lineup_saved event type')
    }
  })
})

describe('lib/decision-os-core barrel exports', () => {
  it('exposes the sport adapter registry, provider adapter registry, and error classes', () => {
    expect(DecisionOSCore.SportAdapterRegistry).toBeDefined()
    expect(DecisionOSCore.sportAdapterRegistry).toBeDefined()
    expect(DecisionOSCore.UnknownSportAdapterError).toBeDefined()
    expect(DecisionOSCore.ProviderAdapterRegistry).toBeDefined()
    expect(DecisionOSCore.providerAdapterRegistry).toBeDefined()
    expect(DecisionOSCore.UnknownProviderAdapterError).toBeDefined()
    expect(DecisionOSCore.registerDefaultSportAdapters).toBeInstanceOf(Function)
    expect(DecisionOSCore.registerDefaultProviderAdapters).toBeInstanceOf(Function)
  })

  it('the shared singleton registries start empty (no side effects from importing the barrel)', () => {
    expect(DecisionOSCore.sportAdapterRegistry.list()).toEqual([])
    expect(DecisionOSCore.providerAdapterRegistry.list()).toEqual([])
  })
})
