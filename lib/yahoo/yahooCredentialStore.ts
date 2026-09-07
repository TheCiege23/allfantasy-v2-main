import { decrypt, encrypt } from '@/lib/league-auth-crypto'
import {
  clearDeadYahooCredentials,
  isTerminalGrantFailure,
  parseOAuthErrorCode,
  YAHOO_RECONNECT_MESSAGE,
} from '@/lib/league-import/yahoo/yahooOAuthRecovery'
import { prisma } from '@/lib/prisma'

/**
 * The one place that decides WHERE a Yahoo credential lives.
 *
 * 🛑 THERE WERE TWO STORES AND THEY COULD NOT SEE EACH OTHER. This is the module
 * that ends that, and the failure it ends is worth stating exactly, because
 * every individual piece of it looked correct in isolation:
 *
 *   - `/api/auth/yahoo/callback` wrote the access and refresh tokens onto
 *     `YahooConnection`.
 *   - `/api/league/yahoo/callback` wrote them onto `league_auths`.
 *   - Everything that actually IMPORTS a league — `YahooLeagueFetchService`,
 *     `league-sync-core`, `yahooOAuthRecovery`, and the `/import` page's own
 *     "are you connected?" check — reads `league_auths` and only `league_auths`.
 *   - `/api/yahoo/leagues` read `YahooConnection` and only `YahooConnection`.
 *
 * So a connect that completed through the first callback stored a perfectly
 * valid token in a table nothing on the import path ever reads, and returned the
 * user to a screen that still asked them to connect Yahoo. Measured in
 * production before this landed: `YahooLeague` 0 rows, `YahooConnection` 0 rows,
 * `import_runs` where provider='yahoo' 0 EVER.
 *
 * ⚠ THE SCHEMA HAD ALREADY PICKED A WINNER AND THE CODE NEVER FOLLOWED. The
 * migration applied to production on 2026-09-04 made `YahooConnection`'s three
 * token columns nullable and added `userId`, demoting that table to an IDENTITY
 * record — see the field comments in `prisma/schema.prisma`. Nothing was changed
 * to match, so the auth callback kept writing tokens into columns the schema had
 * just finished declaring vestigial. This module is the code half of that
 * migration.
 *
 * The division of labour, and it is not negotiable in either direction:
 *
 *   `league_auths`     THE credential. Tokens live here, keyed by APP user.
 *   `YahooConnection`  Identity only — which Yahoo guid belongs to which app
 *                      user, plus a display name and the `YahooLeague` FK
 *                      target. Never a token.
 *
 * ⚠ WHY IDENTITY IS KEYED ON THE APP USER AND NOT ON A COOKIE. `/api/yahoo/leagues`
 * used to resolve the connection from a `yahoo_user_id` cookie with a 30-day
 * maxAge. A cookie is not a credential store either: it dies on a different
 * browser, in a private window, and on day 31 — and when it died the row was
 * unreachable even though it was sitting right there, correctly populated. The
 * session is the only thing that authoritatively says who is asking.
 */

/**
 * Thrown when Yahoo is not connected, or the grant is dead and only re-consent
 * can fix it.
 *
 * 🛑 DEFINED HERE AND RE-EXPORTED BY `YahooLeagueFetchService`, WHICH IS LOAD
 * BEARING. `app/api/leagues/import/discover/route.ts` and
 * `lib/import-os/collector/externalMatchupParity.ts` both branch on
 * `err instanceof YahooImportConnectionError` to turn this into the "Connect
 * Yahoo" sentence the user acts on. Two separately-declared classes with the
 * same name fail that check silently — the error still throws, the message is
 * still right, and the branch that renders the connect button simply never
 * runs. One class, imported everywhere, is what keeps that honest.
 */
export class YahooImportConnectionError extends Error {}

export type YahooCredentialContext = {
  userId: string
  accessToken: string
  refreshToken: string | null
}

/**
 * Tolerates a legacy plaintext token.
 *
 * `/api/yahoo/leagues` has carried this fallback since before the tokens were
 * encrypted; `YahooLeagueFetchService` used a bare `decrypt()` that throws on
 * one. Keeping the tolerant form is the superset — it cannot break a value the
 * strict form would have read, and it can read one the strict form would have
 * thrown on.
 */
function decryptTokenOrRaw(value: string | null | undefined): string {
  if (!value) return ''
  try {
    return decrypt(value)
  } catch {
    return value
  }
}

/**
 * The credential for this app user, or a connection error naming the next step.
 */
export async function loadYahooCredential(userId: string): Promise<YahooCredentialContext> {
  const auth = await (prisma as any).leagueAuth.findUnique({
    where: { userId_platform: { userId, platform: 'yahoo' } },
  })

  if (!auth?.oauthToken) {
    throw new YahooImportConnectionError('Connect Yahoo in League Sync before importing from Yahoo.')
  }

  return {
    userId,
    accessToken: decryptTokenOrRaw(auth.oauthToken),
    refreshToken: auth.oauthSecret ? decryptTokenOrRaw(auth.oauthSecret) : null,
  }
}

/** True when this user holds a usable Yahoo token. Never throws. */
export async function hasYahooCredential(userId: string): Promise<boolean> {
  try {
    const auth = await (prisma as any).leagueAuth.findUnique({
      where: { userId_platform: { userId, platform: 'yahoo' } },
      select: { oauthToken: true },
    })
    return Boolean(auth?.oauthToken)
  } catch {
    return false
  }
}

/**
 * Exchange the refresh token for a new access token and write it back.
 *
 * Mutates `context` in place, because callers hold it across a retry — that is
 * the contract `yahooApiFetchJson` was already written against and it is
 * preserved deliberately.
 */
export async function refreshYahooCredential(context: YahooCredentialContext): Promise<string> {
  const clientId = process.env.YAHOO_CLIENT_ID
  const clientSecret = process.env.YAHOO_CLIENT_SECRET
  if (!clientId || !clientSecret || !context.refreshToken) {
    throw new YahooImportConnectionError('Reconnect Yahoo in League Sync before importing from Yahoo.')
  }

  const response = await fetch('https://api.login.yahoo.com/oauth2/get_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: context.refreshToken,
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    const vendorError = parseOAuthErrorCode(body)

    /*
     * ⚠ `invalid_grant` IS TERMINAL. Per OAuth2 the refresh token is expired,
     * revoked or already used — retrying never recovers it, only re-consent
     * does. Clearing the dead value is what makes every "is Yahoo connected?"
     * check start answering no, which is what puts the Connect button back on
     * the screen.
     *
     * 🛑 ONLY on `invalid_grant`. A 500 or a timeout is Yahoo having a bad day,
     * and clearing on those destroys a working connection over a blip.
     */
    if (isTerminalGrantFailure(body)) {
      await clearDeadYahooCredentials(context.userId)
      throw new YahooImportConnectionError(YAHOO_RECONNECT_MESSAGE)
    }

    // Status and vendor code only. The body can carry token material, and this
    // message is rendered to the user by the discover route.
    console.warn(
      '[Yahoo] token refresh failed status=%d error=%s',
      response.status,
      vendorError ?? 'unrecognised',
    )
    throw new YahooImportConnectionError(
      `Yahoo could not refresh the connection (HTTP ${response.status}). ` +
        'Try again in a moment; reconnect Yahoo in League Sync if it keeps happening.',
    )
  }

  const tokens = await response.json()
  const accessToken = String(tokens.access_token ?? '')
  const refreshToken =
    typeof tokens.refresh_token === 'string' ? tokens.refresh_token : context.refreshToken

  await (prisma as any).leagueAuth.update({
    where: { userId_platform: { userId: context.userId, platform: 'yahoo' } },
    data: {
      oauthToken: encrypt(accessToken),
      oauthSecret: refreshToken ? encrypt(refreshToken) : undefined,
      updatedAt: new Date(),
    },
  })

  context.accessToken = accessToken
  context.refreshToken = refreshToken
  return accessToken
}

/**
 * Store the tokens from a completed OAuth round trip.
 *
 * 🛑 THIS IS THE FIX. Both callbacks call it, so it is no longer possible for
 * one entry point to store a credential the rest of the product cannot find.
 * Adding a third entry point and forgetting to write `league_auths` is the
 * exact bug this replaces; route it through here.
 */
export async function persistYahooCredential(params: {
  userId: string
  accessToken: string
  refreshToken?: string | null
}): Promise<void> {
  const { userId, accessToken, refreshToken } = params

  await (prisma as any).leagueAuth.upsert({
    where: { userId_platform: { userId, platform: 'yahoo' } },
    update: {
      oauthToken: encrypt(accessToken),
      oauthSecret: refreshToken ? encrypt(refreshToken) : undefined,
      updatedAt: new Date(),
    },
    create: {
      userId,
      platform: 'yahoo',
      oauthToken: encrypt(accessToken),
      oauthSecret: refreshToken ? encrypt(refreshToken) : null,
    },
  })
}

/**
 * Record which Yahoo account this app user is, WITHOUT storing a token on it.
 *
 * ⚠ BEST EFFORT ON PURPOSE, AND THE ORDER MATTERS. The credential is what makes
 * an import possible; the identity row only supplies a display name and the FK
 * that `YahooLeague` hangs from. If this write fails, a user who has just
 * connected can still discover and import their leagues. Throwing here would
 * turn a cosmetic problem into a failed connect — the precise trade
 * `clearDeadYahooCredentials` already makes for the same reason.
 *
 * ⚠ `YahooConnection.userId` IS UNIQUE, so a user who reconnects under a
 * DIFFERENT Yahoo account would collide with their own previous row. Detaching
 * the stale row first is what makes reconnecting-as-someone-else work rather
 * than failing on a constraint the user cannot see or act on.
 */
export async function linkYahooIdentity(params: {
  userId: string
  yahooUserId: string
  displayName?: string | null
}): Promise<void> {
  const { userId, yahooUserId, displayName = null } = params
  if (!yahooUserId || yahooUserId === 'unknown') return

  try {
    await (prisma as any).yahooConnection.updateMany({
      where: { userId, NOT: { yahooUserId } },
      data: { userId: null },
    })

    await (prisma as any).yahooConnection.upsert({
      where: { yahooUserId },
      update: { userId, displayName, updatedAt: new Date() },
      create: { yahooUserId, userId, displayName },
    })
  } catch (e) {
    console.warn(
      '[Yahoo] could not link identity for user=%s: %s',
      userId.slice(0, 8),
      e instanceof Error ? e.message.slice(0, 120) : 'unknown',
    )
  }
}

/** The Yahoo identity row for this app user, or null. Never throws. */
export async function getYahooIdentityForUser(userId: string): Promise<{
  id: string
  yahooUserId: string
  displayName: string | null
} | null> {
  try {
    return await (prisma as any).yahooConnection.findUnique({
      where: { userId },
      select: { id: true, yahooUserId: true, displayName: true },
    })
  } catch {
    return null
  }
}
