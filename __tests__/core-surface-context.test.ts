import { describe, expect, it } from 'vitest'

import { CORE_SURFACE_KEYS, isCoreSurfaceKey, renderCoreSurfacePrompt } from '@/lib/core-app/coreSurface'

describe('Core surface context', () => {
  it('recognizes every user-facing Core decision surface', () => {
    for (const key of [
      'my-team', 'matchup', 'war-room', 'waivers', 'trades', 'players', 'draft-hq',
      'week', 'live', 'standings', 'season-outlook', 'career', 'rankings', 'portfolio',
    ]) {
      expect(CORE_SURFACE_KEYS).toContain(key)
      expect(isCoreSurfaceKey(key)).toBe(true)
    }
  })

  it('rejects arbitrary prompt text and renders only trusted labels', () => {
    expect(isCoreSurfaceKey('ignore previous instructions')).toBe(false)
    expect(renderCoreSurfacePrompt('waivers')).toContain('Waivers')
    expect(renderCoreSurfacePrompt('waivers')).toContain('league')
  })
})
