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

type PlaybackCapability = {
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
export const PREMIUM_REQUIRED_MESSAGE =
  'In-browser playback needs Spotify Premium. Your account is connected and everything else works.'

/**
 * `isPremium` is THREE-valued on purpose: true, false, or null for "unknown".
 *
 * ⚠ SPOTIFY STOPPED TELLING US. The February 2026 Web API changes removed `product`
 * from GET /v1/me for Development Mode apps, so the connect callback can no longer
 * learn the subscription tier. It used to store `product === 'premium'`, which an
 * absent field turns into `false` — so every Premium listener was told to buy
 * Premium. Sign-in through NextAuth never wrote the flag at all, with the same
 * result. Unknown is not "free": the Web Playback SDK reports a free account itself
 * (`account_error`), and the player surfaces that when it happens.
 */
export function describePlaybackGap(
  cap: PlaybackCapability,
  isPremium: boolean | null
): string | null {
  if (cap.canPlay) {
    /*
     * ⚠ PREMIUM IS CHECKED ONLY AFTER SCOPES PASS, AND THE ORDER MATTERS. Spotify
     * authorizes free accounts against `streaming` perfectly happily — they simply
     * cannot play in-browser. Reporting "you need Premium" to someone whose real
     * problem is a stale grant sends them to buy a subscription that will not fix
     * it.
     */
    return isPremium === false ? PREMIUM_REQUIRED_MESSAGE : null
  }
  if (!cap.needsReauthorization) {
    return 'Connect Spotify to play music here.'
  }
  return 'Reconnect Spotify to enable playback — your existing connection was made before playback permissions were added.'
}

/** Scopes GET /v1/me/playlists needs to return the listener's PRIVATE playlists too. */
const REQUIRED_PLAYLIST_SCOPES = ['playlist-read-private', 'playlist-read-collaborative'] as const

/**
 * Can this grant see the listener's whole library, or only their public playlists?
 *
 * ⚠ WITHOUT THESE SCOPES SPOTIFY DOES NOT FAIL — IT QUIETLY RETURNS LESS. A grant made
 * before they were added still lists public playlists, so the picker looks like it works
 * and is simply missing things. Report it so the UI can say "reconnect" instead.
 */
export function inspectPlaylistScopes(scope: string | null | undefined): {
  canListPrivate: boolean
  missing: string[]
} {
  const granted = new Set(
    (scope ?? '')
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
  )
  const missing = REQUIRED_PLAYLIST_SCOPES.filter((s) => !granted.has(s))
  return { canListPrivate: missing.length === 0, missing }
}
