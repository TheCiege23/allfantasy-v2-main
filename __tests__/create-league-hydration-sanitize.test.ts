/**
 * Create League v2 — persisted hydration + stale JSON repair (Phase 3A).
 */

import { describe, expect, it } from 'vitest'

import {
  hydrateCreateLeagueInitialState,
  sanitizeReconciledCreateLeagueState,
} from '@/lib/create-league-v2/create-league-initial-hydration'
import { DEFAULT_V2_STATE, getDefaultDynastySetup, getDefaultKeeperSetup } from '@/lib/create-league-v2/state'
import { getScoringPresetOptionsForSelection, getTeamCountOptions } from '@/lib/create-league-v2/rules-engine'

describe('sanitizeReconciledCreateLeagueState', () => {
  it('clears unknown persisted league types', () => {
    const s = sanitizeReconciledCreateLeagueState({
      ...DEFAULT_V2_STATE,
      leagueType: 'not_a_real_type' as never,
      creationMode: 'advanced',
    })
    expect(s.leagueType).toBeNull()
  })

  it('normalizes sport aliases from persisted JSON', () => {
    const s = sanitizeReconciledCreateLeagueState({
      ...DEFAULT_V2_STATE,
      leagueType: 'redraft',
      sport: 'EURO' as never,
      creationMode: 'quick',
    })
    expect(s.sport).toBe('SOCCER')
  })

  it('turns off IDP when sport does not support IDP', () => {
    const s = sanitizeReconciledCreateLeagueState({
      ...DEFAULT_V2_STATE,
      leagueType: 'redraft',
      sport: 'NBA',
      idpSelected: true,
      creationMode: 'advanced',
    })
    expect(s.idpSelected).toBe(false)
  })

  it('clamps team count when persisted value is invalid for format', () => {
    const base = {
      ...DEFAULT_V2_STATE,
      leagueType: 'redraft' as const,
      sport: 'NFL' as const,
      teamCount: 7,
      creationMode: 'advanced' as const,
      keeper: getDefaultKeeperSetup(),
      dynasty: { ...getDefaultDynastySetup('NFL', 'snake'), draftMode: 'offline' as const, draftDateUtc: '' },
    }
    const s = sanitizeReconciledCreateLeagueState(base)
    expect(s.teamCount).not.toBe(7)
    const allowedTeams = getTeamCountOptions(s.sport, 'redraft', s.soccerPipeline, s.draftType, false)
    expect(allowedTeams).toContain(s.teamCount)
  })

  it('resets dynasty scheduled mode when draft timestamp is garbage', () => {
    const d = getDefaultDynastySetup('NFL', 'snake')
    const s = sanitizeReconciledCreateLeagueState({
      ...DEFAULT_V2_STATE,
      leagueType: 'dynasty',
      creationMode: 'advanced',
      dynasty: { ...d, draftMode: 'scheduled', draftDateUtc: 'not-a-date' },
    })
    expect(s.dynasty.draftMode).toBe('offline')
    expect(s.dynasty.draftDateUtc).toBe('')
  })
})

describe('hydrateCreateLeagueInitialState', () => {
  it('recovers quick mode from stale persisted state and yields valid scoring', () => {
    const hydrated = hydrateCreateLeagueInitialState(
      {
        creationMode: 'quick',
        leagueType: 'bogus' as never,
        sport: 'NFL',
        name: 'Persisted',
        nameTouched: true,
      },
      'quick',
    )
    expect(hydrated.creationMode).toBe('quick')
    expect(hydrated.leagueType).toBe('redraft')
    const opts = getScoringPresetOptionsForSelection({
      leagueType: 'redraft',
      sport: hydrated.sport,
      idpSelected: false,
    })
    expect(opts.some((o) => o.id === hydrated.scoringPresetId)).toBe(true)
  })

  it('honors advanced mode from URL over persisted quick', () => {
    const hydrated = hydrateCreateLeagueInitialState(
      {
        creationMode: 'quick',
        leagueType: 'dynasty',
        sport: 'NFL',
        name: 'Dyn',
        nameTouched: true,
      },
      'advanced',
    )
    expect(hydrated.creationMode).toBe('advanced')
    expect(hydrated.leagueType).toBe('dynasty')
  })
})
