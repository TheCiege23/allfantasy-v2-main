import { describe, expect, it } from 'vitest'
import {
  isDraftFullscreenFromSearchParams,
  isEmbedModeFromSearchParams,
  shouldHideGlobalChromeInEmbedMode,
} from '@/lib/navigation/embedMode'

describe('embedMode helpers', () => {
  it('detects embed=1 from URLSearchParams', () => {
    expect(isEmbedModeFromSearchParams(new URLSearchParams('embed=1'))).toBe(true)
    expect(isEmbedModeFromSearchParams(new URLSearchParams('embed=true'))).toBe(true)
    expect(isEmbedModeFromSearchParams(new URLSearchParams('embed=0'))).toBe(false)
  })

  it('detects embed from plain record', () => {
    expect(isEmbedModeFromSearchParams({ embed: '1' })).toBe(true)
    expect(shouldHideGlobalChromeInEmbedMode({ embed: 'true' })).toBe(true)
  })

  it('detects draftFullscreen', () => {
    expect(isDraftFullscreenFromSearchParams(new URLSearchParams('draftFullscreen=1'))).toBe(true)
  })
})
