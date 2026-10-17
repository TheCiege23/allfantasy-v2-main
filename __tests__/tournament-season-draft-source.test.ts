import { describe, expect, it } from 'vitest'
import { resolveDraftIdProvenance } from '@/lib/draft-room/draftIdProvenance'

describe('tournament draft ID source evidence', () => {
  it('keeps equal-looking Sleeper and Rolling Insights numbers in separate namespaces', () => {
    const ri = { player_id: 'sports-ri', sleeper_id: null, external_source_id: '4876', metadata: { source: 'rolling_insights' } }
    expect(resolveDraftIdProvenance('NFL', '4876', ri).namespace).toBe('unknown')
    expect(resolveDraftIdProvenance('NBA', '4876', ri)).toEqual({ namespace: 'rolling_insights', sourceRecordId: 'sports-ri' })
    const sleeper = { ...ri, player_id: 'sports-sleeper', sleeper_id: '4876' }
    expect(resolveDraftIdProvenance('NFL', '4876', sleeper)).toEqual({ namespace: 'sleeper', sourceRecordId: 'sports-sleeper' })
    expect(resolveDraftIdProvenance('NBA', '4876', sleeper).namespace).toBe('unknown')
  })
  it('leaves a fallback or different selected ID unresolved', () => {
    expect(resolveDraftIdProvenance('NBA', 'name:unknown', { player_id: 'sports-ri', external_source_id: '4876', metadata: { source: 'rolling_insights' } }).namespace).toBe('unknown')
    expect(resolveDraftIdProvenance('NBA', '4876', { player_id: 'fallback', external_source_id: '4876', metadata: { source: 'identity_fallback' } }).namespace).toBe('unknown')
  })
})
