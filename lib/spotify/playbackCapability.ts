/**
 * Does a stored Spotify authorization actually permit playback?
 *
 * ⚠ THIS EXISTS BECAUSE A TOKEN CAN BE PERFECTLY VALID AND STILL UNABLE TO PLAY
 * ANYTHING, AND NOTHING DETECTED THAT. Measured in production: all 8 connected
 * Spotify accounts carry `scope: user-read-email` and nothing else. That token
 * refreshes fine, identifies the user fine, and satisfies every check the widget
 * made — so the player rendered, looked connected, and silently could not start
 * audio.
 *
 * The scope list was widened (see ./scopes) so NEW authorizations carry playback
 * scopes. But a widened list does nothing for a token already issued: Spotify
 * grants scopes at authorization time. Every existing user must RE-AUTHORIZE, and
 * until they do, the honest thing is to say so rather than render a dead player.
 */

/** Scopes the Web Playback SDK requires to control audio in the browser. */
export const REQUIRED_PLAYBACK_SCOPES = [
  'streaming',
  'user-read-playback-state',
  'user-modify-playback-state',
] as const

export type PlaybackCapability = {
  canPlay: boolean
  /** Scopes the stored grant is missing, for a precise message. */
  missing: string[]
  /** True when a grant exists but predates the playback scopes. */
  needsReauthorization: boolean
}

/**
 * Inspect a stored scope string.
 *
 * ⚠ A NULL OR EMPTY SCOPE IS TREATED AS INCAPABLE, NOT AS UNKNOWN. Assuming
 * capability on missing data is how this bug stayed invisible: the widget
 * defaulted to "probably fine" and the user got silence.
 */
export function inspectPlaybackScopes(scope: string | null | undefined): PlaybackCapability {
  const granted = new Set(
    (scope ?? '')
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
  )
  const missing = REQUIRED_PLAYBACK_SCOPES.filter((s) => !granted.has(s))
  return {
    canPlay: missing.length === 0,
    missing,
    // A grant that exists but lacks playback is a stale authorization; no grant at
    // all is simply "not connected" and is a different message.
    needsReauthorization: granted.size > 0 && missing.length > 0,
  }
}

/**
 * The sentence to show the user.
 *
 * ⚠ NEVER SAY "SOMETHING WENT WRONG". The cause is precise and the remedy is one
 * click, so the message should say both. A vague error would send someone to
 * check their speakers, their Premium status, and their network before
 * discovering that the fix is reconnecting.
 */
export function describePlaybackGap(cap: PlaybackCapability, isPremium: boolean): string | null {
  if (cap.canPlay) {
    /*
     * ⚠ PREMIUM IS CHECKED ONLY AFTER SCOPES PASS, AND THE ORDER MATTERS. Spotify
     * authorizes free accounts against `streaming` perfectly happily — they simply
     * cannot play in-browser. Reporting "you need Premium" to someone whose real
     * problem is a stale grant sends them to buy a subscription that will not fix
     * it.
     */
    return isPremium
      ? null
      : 'In-browser playback needs Spotify Premium. Your account is connected and everything else works.'
  }
  if (!cap.needsReauthorization) {
    return 'Connect Spotify to play music here.'
  }
  return 'Reconnect Spotify to enable playback — your existing connection was made before playback permissions were added.'
}
