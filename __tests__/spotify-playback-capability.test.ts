import { describe, expect, it } from 'vitest'
import {
  inspectPlaybackScopes,
  describePlaybackGap,
  REQUIRED_PLAYBACK_SCOPES,
} from '@/lib/spotify/playbackCapability'

describe('Spotify playback capability', () => {
  it('detects the exact production state — identity-only grants cannot play', () => {
    // All 8 connected accounts in production hold precisely this.
    const cap = inspectPlaybackScopes('user-read-email')
    expect(cap.canPlay).toBe(false)
    expect(cap.needsReauthorization).toBe(true)
    expect(cap.missing).toEqual([...REQUIRED_PLAYBACK_SCOPES])
  })

  it('accepts a full modern grant', () => {
    const cap = inspectPlaybackScopes(
      'user-read-email user-read-private streaming user-read-playback-state user-modify-playback-state'
    )
    expect(cap.canPlay).toBe(true)
    expect(cap.needsReauthorization).toBe(false)
  })

  it('treats a missing scope string as INCAPABLE, not as unknown', () => {
    // Assuming capability on absent data is how this bug stayed invisible.
    expect(inspectPlaybackScopes(null).canPlay).toBe(false)
    expect(inspectPlaybackScopes('').canPlay).toBe(false)
  })

  it('distinguishes "never connected" from "connected but stale"', () => {
    // Different remedies: one is Connect, the other is Reconnect.
    expect(inspectPlaybackScopes(null).needsReauthorization).toBe(false)
    expect(inspectPlaybackScopes('user-read-email').needsReauthorization).toBe(true)
  })

  it('blames the stale grant BEFORE blaming Premium', () => {
    // Telling a free user "you need Premium" when the real fault is a stale
    // grant sends them to buy a subscription that will not fix it.
    const stale = inspectPlaybackScopes('user-read-email')
    expect(describePlaybackGap(stale, false)).toMatch(/Reconnect/)
    expect(describePlaybackGap(stale, true)).toMatch(/Reconnect/)
  })

  it('reports Premium only once scopes are sound', () => {
    const good = inspectPlaybackScopes(
      'streaming user-read-playback-state user-modify-playback-state'
    )
    expect(describePlaybackGap(good, true)).toBeNull()
    expect(describePlaybackGap(good, false)).toMatch(/Premium/)
  })
})
