/**
 * Who may START a Spotify connection from AllFantasy.
 *
 * ⚠ WHY THIS EXISTS: Spotify's Development Mode only lets accounts allowlisted in the
 * Spotify Developer Dashboard (Settings → Users Management) authorize the app; everyone
 * else is stopped on Spotify's own "User not registered in the Developer Dashboard" page.
 * So Connect was gated off for every user — including the owner and the testers who ARE
 * allowlisted, which left no way to try Spotify from the app at all.
 *
 * This mirrors Spotify's allowlist on our side:
 *
 *   SPOTIFY_CONNECT_ALLOWLIST  comma/space separated AllFantasy account emails.
 *                              Keep it in step with Users Management on Spotify's
 *                              dashboard — an email listed here but not there still
 *                              hits Spotify's 403.
 *   SPOTIFY_CONNECT_OPEN=1     everyone may connect. Set once Spotify grants Extended
 *                              Quota Mode; the allowlist is then irrelevant.
 *
 * Unset, nobody new may connect — the same behaviour as before this file existed.
 *
 * ⚠ AN ALREADY-CONNECTED USER MAY ALWAYS RECONNECT. The mini player tells stale grants
 * to "Reconnect Spotify" for new scopes; blocking that would strand the existing
 * connections, all of which were made by accounts Spotify had already let through.
 *
 * Server-only: the list is never sent to the client, only the per-user answer.
 */

export function parseSpotifyAllowlist(raw: string | undefined | null): Set<string> {
  return new Set(
    (raw ?? '')
      .split(/[\s,;]+/)
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.includes('@'))
  )
}

function isSpotifyConnectOpen(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.SPOTIFY_CONNECT_OPEN ?? '').trim().toLowerCase()
  return v === '1' || v === 'true'
}

export function canConnectSpotify(
  user: { email: string | null | undefined; alreadyConnected: boolean },
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (user.alreadyConnected) return true
  if (isSpotifyConnectOpen(env)) return true
  const email = (user.email ?? '').trim().toLowerCase()
  if (!email) return false
  return parseSpotifyAllowlist(env.SPOTIFY_CONNECT_ALLOWLIST).has(email)
}
