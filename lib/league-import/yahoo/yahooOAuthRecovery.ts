import { prisma } from '@/lib/prisma'

/**
 * Recovery from a dead Yahoo OAuth grant — shared, because there are TWO token
 * refresh implementations (`YahooLeagueFetchService` and `league-sync-core`) and
 * they had drifted apart on exactly this.
 *
 * One threw the vendor's raw JSON at the user; the other had a good message.
 * NEITHER cleared the dead credential, which is the part that actually traps
 * the user: `oauthToken` staying present means every "is Yahoo connected?" check
 * says yes, so the surface never offers a reconnect and the same failure repeats
 * forever.
 */

/**
 * The OAuth2 `error` code from a token-endpoint failure, or null.
 *
 * Deliberately returns only the fixed machine code, never the body.
 * `error_description` is free vendor text and these values reach logs.
 */
export function parseOAuthErrorCode(body: string): string | null {
  if (!body) return null
  try {
    const code = (JSON.parse(body) as { error?: unknown }).error
    return typeof code === 'string' && code ? code : null
  } catch {
    // Yahoo answers with HTML on some failures; there is no code to read.
    return null
  }
}

/**
 * True when Yahoo says the grant is dead and only re-consent can fix it.
 *
 * 🛑 `invalid_grant` ONLY. A 500, a timeout or a 503 is Yahoo having a bad day,
 * and clearing on those would turn a transient blip into a forced reconnect —
 * the opposite mistake, and the worse one, because it destroys a working
 * connection the user would otherwise never have noticed was interrupted.
 */
export function isTerminalGrantFailure(body: string): boolean {
  return parseOAuthErrorCode(body) === 'invalid_grant'
}

/**
 * Drop a refresh token Yahoo has permanently rejected.
 *
 * Not destructive in any sense that matters: the value cannot be used again.
 * Leaving it is what made the failure unrecoverable. Removing it is what makes
 * the surface say "Connect Yahoo" and show the button.
 *
 * Best-effort on purpose — if this write fails the caller's message is still
 * correct and the user can still reconnect. Throwing here would replace an
 * actionable error with a database one.
 */
export async function clearDeadYahooCredentials(userId: string): Promise<void> {
  try {
    await (prisma as { leagueAuth: { update: (a: unknown) => Promise<unknown> } }).leagueAuth.update({
      where: { userId_platform: { userId, platform: 'yahoo' } },
      data: { oauthToken: null, oauthSecret: null, updatedAt: new Date() },
    })
  } catch (e) {
    console.warn(
      '[Yahoo] could not clear dead credentials for user=%s: %s',
      userId.slice(0, 8),
      e instanceof Error ? e.message.slice(0, 120) : 'unknown',
    )
  }
}

/** The one message both paths show. Actionable, and free of vendor JSON. */
export const YAHOO_RECONNECT_MESSAGE =
  'Yahoo access expired — reconnect Yahoo in League Sync to continue. ' +
  'This happens when the authorisation is revoked or goes unused for a long period.'
