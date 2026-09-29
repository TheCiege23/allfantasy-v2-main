/**
 * Server-side session revocation for next-auth's stateless JWT sessions.
 *
 * WHY. Sessions are signed cookies (strategy "jwt"): sign-out only deletes the
 * cookie on the device. If the device keeps or restores it, the server has
 * nothing that says "that session ended" and accepts it for the rest of its 30
 * days. Measured 2026-09-29 in the iOS app: sign out, close the app, reopen —
 * signed in again as the same account. WKWebView writes cookie changes to disk
 * lazily, so a sign-out followed by closing the app can be lost, and the old
 * cookie comes back. (The website has the same exposure for any cookie that is
 * copied or restored, it just rarely happens.)
 *
 * WHAT. Every session carries a random `sid` (stamped in the jwt callback).
 * Signing out records that sid as revoked, so a returning cookie is refused and
 * cleared — only THAT device's session: signing out on the phone does not sign
 * you out on the computer. Deleting an account revokes every session the user
 * has (a user-wide "issued before" line).
 *
 * WHERE. Upstash Redis over REST (UPSTASH_REDIS_REST_URL/_TOKEN, set in
 * production) — plain fetch, so the edge middleware can ask too. Keys expire
 * with the longest session, so nothing accumulates.
 *
 * ⚠ FAILS OPEN, DELIBERATELY. If Redis is unset, slow or down, a session is
 * treated as NOT revoked. The alternative — refusing every session whenever
 * Redis blinks — signs out the whole product. What fail-open loses is only the
 * resurrected-cookie case during an outage, which is what we had before this.
 */

/** Matches `session.maxAge` in lib/auth.ts: no token outlives this. */
export const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60

const LOOKUP_TIMEOUT_MS = 800
/** A "still valid" answer is reused briefly so a page's several session reads cost one lookup. */
const VALID_CACHE_MS = 15_000

const SID_KEY = (sid: string) => `af:auth:revoked-sid:${sid}`
const USER_KEY = (userId: string) => `af:auth:revoked-user:${userId}`

/**
 * Any decoded session token. A record, not `{ sid?, id?, … }`: an all-optional object type is a
 * "weak type", and TypeScript refuses next-auth's JWT for it (TS2559). Fields are read defensively.
 */
type Token = Record<string, unknown> | null | undefined

function config(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim()
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
  return url && token ? { url, token } : null
}

async function redis(args: (string | number)[]): Promise<unknown | undefined> {
  const cfg = config()
  if (!cfg) return undefined
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS)
  try {
    const res = await fetch(cfg.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
      signal: controller.signal,
      cache: "no-store",
    })
    if (!res.ok) return undefined
    const json = (await res.json()) as { result?: unknown }
    return json.result
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

/** A fresh session id — stamped once at sign-in and carried by every refresh of that token. */
export function newSessionId(): string {
  return crypto.randomUUID()
}

// In-process memory: revoked sids are remembered until their key would expire;
// "valid" answers only for VALID_CACHE_MS, so a revocation elsewhere lands fast.
const revokedHere = new Map<string, number>()
const validUntil = new Map<string, number>()

function remember(map: Map<string, number>, key: string, until: number) {
  if (map.size > 5000) map.clear()
  map.set(key, until)
}

function tokenStr(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null
}

function tokenNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null
}

function ttlFor(token: Token, nowS: number): number {
  const exp = tokenNum(token?.exp)
  const left = exp ? Math.ceil(exp - nowS) : SESSION_MAX_AGE_S
  return Math.max(60, Math.min(left, SESSION_MAX_AGE_S))
}

/**
 * Sign-out: revoke THIS session. A token without a sid (issued before sids
 * existed) cannot be told apart from the user's other sessions, so it revokes
 * every session of that user issued up to now — a one-time cost of the upgrade.
 */
export async function revokeSessionForSignOut(token: Token, nowS = Math.floor(Date.now() / 1000)): Promise<void> {
  const sid = tokenStr(token?.sid)
  if (sid) {
    remember(revokedHere, sid, Date.now() + ttlFor(token, nowS) * 1000)
    validUntil.delete(sid)
    await redis(["SET", SID_KEY(sid), "1", "EX", ttlFor(token, nowS)])
    return
  }
  const userId = tokenStr(token?.id)
  if (userId) await revokeAllSessionsForUser(userId, nowS)
}

/** Account deletion (or a compromise): every session of this user issued up to now is refused. */
export async function revokeAllSessionsForUser(userId: string, nowS = Math.floor(Date.now() / 1000)): Promise<void> {
  validUntil.clear()
  await redis(["SET", USER_KEY(userId), String(nowS), "EX", SESSION_MAX_AGE_S])
}

/**
 * true = revoked (refuse it); false = valid, or nobody could tell (fail open).
 * One Redis round trip for both checks, and cached as described above.
 */
export async function isSessionRevoked(token: Token): Promise<boolean> {
  const sid = tokenStr(token?.sid)
  const userId = tokenStr(token?.id)
  if (!sid && !userId) return false
  const now = Date.now()
  const cacheKey = `${sid ?? "-"}|${userId ?? "-"}`
  if (sid && (revokedHere.get(sid) ?? 0) > now) return true
  if ((validUntil.get(cacheKey) ?? 0) > now) return false

  const keys = [sid ? SID_KEY(sid) : "af:auth:none", userId ? USER_KEY(userId) : "af:auth:none"]
  const result = await redis(["MGET", ...keys])
  if (!Array.isArray(result)) return false // unknown → fail open, uncached so the next read retries

  const sidRevoked = Boolean(sid && result[0])
  const cutoff = Number(result[1])
  const iat = tokenNum(token?.iat)
  const userRevoked = Number.isFinite(cutoff) && cutoff > 0 && iat !== null && iat <= cutoff
  if (sidRevoked || userRevoked) {
    if (sid) remember(revokedHere, sid, now + SESSION_MAX_AGE_S * 1000)
    return true
  }
  remember(validUntil, cacheKey, now + VALID_CACHE_MS)
  return false
}

/** Thrown from the jwt callback so next-auth clears the cookie (its session route does, on any throw). */
export class SessionRevokedError extends Error {
  constructor() {
    super("SESSION_REVOKED")
    this.name = "SessionRevokedError"
  }
}

export function __resetSessionRevocationCache(): void {
  revokedHere.clear()
  validUntil.clear()
}
