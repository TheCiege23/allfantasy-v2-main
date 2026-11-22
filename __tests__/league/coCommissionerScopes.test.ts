import { describe, expect, it } from 'vitest'
import {
  CO_COMMISSIONER_SCOPES,
  CO_COMMISSIONER_SCOPES_KEY,
  coCommissionerAllowed,
  hasConfiguredScopes,
  missingScopeMessage,
  parseScopeList,
  readCoCommissionerScopes,
  scopeForSettingsKey,
  scopesForSettingsPatch,
  withCoCommissionerScopes,
} from '@/lib/league/coCommissionerScopes'

describe('co-commissioner scopes (pure)', () => {
  it('an unconfigured co-commissioner holds every scope — nobody loses access when this ships', () => {
    expect(readCoCommissionerScopes({}, 't1')).toEqual([...CO_COMMISSIONER_SCOPES])
    expect(readCoCommissionerScopes(null, 't1')).toEqual([...CO_COMMISSIONER_SCOPES])
    expect(hasConfiguredScopes({}, 't1')).toBe(false)
  })

  it('a saved list is exactly what it lists; an empty list is view-only', () => {
    let s = withCoCommissionerScopes({ keep: 1 }, 't1', ['trades', 'scoring'])
    expect(s.keep).toBe(1)
    expect(readCoCommissionerScopes(s, 't1')).toEqual(['scoring', 'trades'])
    expect(readCoCommissionerScopes(s, 't2')).toEqual([...CO_COMMISSIONER_SCOPES])
    s = withCoCommissionerScopes(s, 't2', [])
    expect(readCoCommissionerScopes(s, 't2')).toEqual([])
    expect(hasConfiguredScopes(s, 't2')).toBe(true)
  })

  it('removing the last entry drops the key; the input object is not mutated', () => {
    const input = { [CO_COMMISSIONER_SCOPES_KEY]: { t1: ['money'] } }
    const out = withCoCommissionerScopes(input, 't1', null)
    expect(CO_COMMISSIONER_SCOPES_KEY in out).toBe(false)
    expect(input[CO_COMMISSIONER_SCOPES_KEY].t1).toEqual(['money'])
  })

  it('a stored list with junk keeps only known scopes', () => {
    expect(readCoCommissionerScopes({ [CO_COMMISSIONER_SCOPES_KEY]: { t1: ['chat', 'admin', 7] } }, 't1')).toEqual(['chat'])
  })

  it('parseScopeList is strict', () => {
    expect(parseScopeList(['money', 'chat'])).toEqual(['money', 'chat'])
    expect(parseScopeList([])).toEqual([])
    expect(parseScopeList(['money', 'admin'])).toBeNull()
    expect(parseScopeList('money')).toBeNull()
  })

  it('allowed when ANY of the user’s co-commissioner teams holds every required scope', () => {
    const s = withCoCommissionerScopes(withCoCommissionerScopes({}, 'a', ['trades']), 'b', ['money', 'chat'])
    expect(coCommissionerAllowed(s, ['a'], ['trades'])).toBe(true)
    expect(coCommissionerAllowed(s, ['a'], ['money'])).toBe(false)
    expect(coCommissionerAllowed(s, ['a'], ['trades', 'money'])).toBe(false)
    expect(coCommissionerAllowed(s, ['a', 'b'], ['money', 'chat'])).toBe(true)
    expect(coCommissionerAllowed(s, ['a'], [])).toBe(true)
    expect(coCommissionerAllowed(s, [], ['trades'])).toBe(false)
  })

  it.each([
    ['tradeReviewHours', 'trades'],
    ['tradeDeadlineWeek', 'trades'],
    ['draftPickTrading', 'trades'],
    ['rosterSize', 'rosters'],
    ['keeperCount', 'rosters'],
    ['keeperSlots', 'rosters'],
    ['keeper_min_cost_round', 'rosters'],
    ['taxiSlots', 'rosters'],
    ['irSlots', 'rosters'],
    ['lineupLockRule', 'rosters'],
    ['scoringPresetId', 'scoring'],
    ['medianGame', 'scoring'],
    ['draftType', 'league'],
    ['draftOrderSlots', 'league'],
    ['rounds', 'league'],
    ['pickTimerPreset', 'league'],
    ['aiScope', 'league'],
    ['waiverSchedule', 'league'],
    ['playoffTeams', 'league'],
    ['timezone', 'league'],
    ['entryFee', 'money'],
    ['payoutStructure', 'money'],
  ])('%s → %s', (key, scope) => {
    expect(scopeForSettingsKey(key)).toBe(scope)
  })

  it('a patch is classified by section, top-level keys and settingsMerge keys; leagueId is ignored', () => {
    expect(scopesForSettingsPatch({ leagueId: 'L', tradeReviewHours: 24 })).toEqual(['trades'])
    expect(scopesForSettingsPatch({ leagueId: 'L', settingsMerge: { keeper_waiver_cost_round: 9, publicStandings: true } })).toEqual(['rosters', 'league'])
    expect(scopesForSettingsPatch({ leagueId: 'L', medianGame: true }, 'roster')).toEqual(['scoring', 'rosters'])
    expect(scopesForSettingsPatch({ leagueId: 'L' }, 'general')).toEqual(['league'])
    expect(scopesForSettingsPatch({ leagueId: 'L' })).toEqual([])
  })

  it('the refusal names the missing areas in plain words', () => {
    expect(missingScopeMessage(['trades', 'money'])).toBe('The head commissioner hasn’t given you trades and money permission in this league.')
  })
})
