/**
 * ONE Spotify scope list, shared by both flows that ask Spotify for authorization.
 *
 * There are two: NextAuth's SpotifyProvider (sign-in) and the custom connect flow at
 * /api/auth/spotify (music widget). They target the SAME Spotify app via SPOTIFY_CLIENT_ID,
 * so a user who signs in with Spotify and a user who connects Spotify should end up holding
 * equally capable tokens. They did not, and the drift broke both features at once:
 *
 *   - next-auth's provider default is `scope=user-read-email` ONLY, and its userinfo step
 *     calls GET https://api.spotify.com/v1/me. That endpoint needs `user-read-private`, so
 *     Spotify answered 403 Forbidden and next-auth surfaced OAuthCallbackError — sign-in
 *     failed at the callback, after the token exchange had already succeeded.
 *   - even had it succeeded, the resulting token carried no playback scopes, so the token
 *     that /api/spotify/token hands the Web Playback SDK could not control playback.
 *
 * Keeping one list means adding a capability updates both flows, and neither can silently
 * regress the other. Anything added here takes effect for new authorizations only —
 * existing users must re-authorize before their token carries a newly added scope.
 */

/** Identity — required by next-auth's `/v1/me` userinfo step. Both are needed: */
const IDENTITY_SCOPES = [
  // returns the email claim next-auth maps to the account
  "user-read-email",
  // required for /v1/me to return the profile at all — its absence is the 403
  "user-read-private",
] as const

/**
 * Playback — required by the Web Playback SDK behind the floating music widget.
 * `streaming` additionally requires the listener to have Spotify Premium; free accounts
 * authorize fine and simply cannot play in-browser, so this must never gate sign-in.
 */
const PLAYBACK_SCOPES = [
  "streaming",
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
] as const

export const SPOTIFY_SCOPE_LIST: readonly string[] = [...IDENTITY_SCOPES, ...PLAYBACK_SCOPES]

/** Space-delimited, the encoding Spotify's `scope` parameter expects. */
export const SPOTIFY_SCOPES: string = SPOTIFY_SCOPE_LIST.join(" ")
