/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { V2_STORAGE_KEY, loadPersistedV2State, DEFAULT_V2_STATE } from '@/lib/create-league-v2/state'
import { sanitizeReconciledCreateLeagueState } from '@/lib/create-league-v2/create-league-initial-hydration'

describe('create league v2 Phase 4B persistence & sanitize', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('loadPersistedV2State returns null for invalid JSON', () => {
    sessionStorage.setItem(V2_STORAGE_KEY, 'not-json{')
    expect(loadPersistedV2State()).toBeNull()
  })

  it('loadPersistedV2State returns null for JSON array payloads', () => {
    sessionStorage.setItem(V2_STORAGE_KEY, '[]')
    expect(loadPersistedV2State()).toBeNull()
  })

  it('loadPersistedV2State returns object for valid partial state', () => {
    sessionStorage.setItem(V2_STORAGE_KEY, JSON.stringify({ sport: 'NBA', teamCount: 10 }))
    const p = loadPersistedV2State()
    expect(p?.sport).toBe('NBA')
    expect(p?.teamCount).toBe(10)
  })

  it('sanitizeReconciledCreateLeagueState clears unknown selectedTemplateId', () => {
    const s = sanitizeReconciledCreateLeagueState({
      ...DEFAULT_V2_STATE,
      selectedTemplateId: 'legacy_fake_template' as typeof DEFAULT_V2_STATE.selectedTemplateId,
    })
    expect(s.selectedTemplateId).toBeNull()
  })
})
