/**
 * The ACCOUNT-level Washington lock: once an account is seen in Washington on a
 * normal connection, it stays locked out of the whole product — from any
 * location, over any connection — until support unlocks it.
 *
 * ⚠ WHY AN ACCOUNT LOCK AT ALL. Every other gate reads the location of the
 * request's IP. A residential proxy that the VPN vendor has not catalogued looks
 * exactly like a home connection in another state, so a Washington resident who
 * signs in once from home and then adds such a proxy walks straight back in. The
 * lock turns "where is this request" into "where has this account been", which
 * the proxy cannot rewrite after the fact.
 *
 * Owner's decisions, 2026-09-24:
 *   - The lock is STICKY. A later normal visit from another state does not clear
 *     it, because an undetected residential proxy produces exactly that visit.
 *     The cost is a traveller seen in Seattle, who emails support.
 *   - Washington only, for the FULL lock. Paid-feature states are gated by the
 *     card's billing address instead, NOT by the signup-state flag — so
 *     `paid_block` rows written at signup are ignored here.
 *
 * THE CARD LOCK (2026-09-25). A purchase whose card billing address is in a
 * restricted state is refused and refunded by the Stripe webhook
 * (lib/subscription/paidStateRefusal), which then sets `card_paid_block`: paid
 * surfaces only, from anywhere, until support unlocks it. It is DELIBERATELY a
 * different value from the signup route's `paid_block`, which records where a
 * signup's IP appeared to be — the owner chose the card over that signal.
 * A card-locked account later seen in Washington escalates to the full lock, and
 * a WASHINGTON card goes straight to it (owner, 2026-09-25).
 *
 * STORAGE, WITHOUT A MIGRATION. It reuses the three AppUser columns the signup
 * route already writes and nothing ever read: `stateRestrictionLevel` =
 * "full_block" or "card_paid_block" is the lock, `isStateRestricted` mirrors it,
 * `detectedStateCode` records the state a full lock was SEEN in (the card lock
 * leaves it alone — it is not a sighting).
 *
 * ⚠ COST. This runs inside the NextAuth `jwt` callback, which runs on every one of
 * ~2,259 `getServerSession` call sites. So: a normal request costs a header read
 * and a Map lookup. The database is read at most once per user per TTL per
 * process, and written once, when a lock is created. Only a request that is
 * actually placed in Washington does any extra work.
 *
 * ⚠ The lock only ever comes from the DATABASE. The jwt callback's `update`
 * trigger carries an attacker-controlled payload with a privilege-escalation
 * history (lib/auth.ts); nothing a browser sends can set or clear this.
 */

import { clientIpFromHeaders } from "@/lib/http/clientIp"

import { resolveAnonymizerByIp } from "./anonymizerCache"
import { isTorExit, resolveEdgeGeo } from "./geoHeaders"
import { isFullyBlocked } from "./restrictedStates"

export const ACCOUNT_FULL_BLOCK = "full_block" as const
/** Paid surfaces only. Set when a purchase's card billing address was in a restricted state. */
export const ACCOUNT_CARD_PAID_BLOCK = "card_paid_block" as const
export type AccountGeoLock = typeof ACCOUNT_FULL_BLOCK | typeof ACCOUNT_CARD_PAID_BLOCK | null

/** The lock a stored `stateRestrictionLevel` means. The signup route's `paid_block` means none. */
export function accountGeoLockFromLevel(level: string | null | undefined): AccountGeoLock {
  if (level === ACCOUNT_FULL_BLOCK) return ACCOUNT_FULL_BLOCK
  if (level === ACCOUNT_CARD_PAID_BLOCK) return ACCOUNT_CARD_PAID_BLOCK
  return null
}

export interface AccountLockStore {
  /** The account's lock, or `undefined` when the read FAILED — which must never read as "unlocked". */
  read(userId: string): Promise<AccountGeoLock | undefined>
  /** Lock the account, recording the state that caused it. */
  lock(userId: string, stateCode: string): Promise<void>
}

const TTL_MS = 10 * 60 * 1000
const MAX_ENTRIES = 20_000

interface Entry {
  lock: AccountGeoLock
  expiresAt: number
}

const cache = new Map<string, Entry>()

/** Test seam. Nothing in production should need to reset this. */
export function __resetAccountGeoLockCache(): void {
  cache.clear()
}

/** Called after support unlocks an account, so this process stops serving the old answer. */
export function forgetAccountGeoLock(userId: string): void {
  cache.delete(userId)
}

function remember(userId: string, lock: AccountGeoLock, now: number): void {
  if (cache.size >= MAX_ENTRIES && !cache.has(userId)) {
    const oldest = cache.keys().next()
    if (!oldest.done) cache.delete(oldest.value)
  }
  cache.set(userId, { lock, expiresAt: now + TTL_MS })
}

/**
 * Is this request a normal (non-anonymized) connection placed in a full-block
 * state? Returns the state code, or null.
 *
 * ⚠ "Normal" means the anonymizer check did not say YES. A vendor outage
 * (`null`) still counts as normal here, deliberately and unlike the VPN gate:
 * that gate fails open so an outage cannot lock anyone out of a legal state,
 * whereas this request is ALREADY placed in Washington by its IP and already
 * refused. The only person an outage could wrongly lock is someone whose VPN
 * happens to exit in Washington during the outage — and support can undo that.
 */
export async function fullBlockStateOfNormalConnection(headers: Headers): Promise<string | null> {
  const edge = resolveEdgeGeo(headers)
  if (edge.country !== "US" || !edge.regionCode || !isFullyBlocked(edge.regionCode)) return null
  if (isTorExit(headers)) return null
  const ip = clientIpFromHeaders(headers)
  if (ip && (await resolveAnonymizerByIp(ip)) === true) return null
  return edge.regionCode
}

/**
 * Observe this request and return the account's lock.
 *
 * `headers` is `null` outside a request (a script, a worker), which only skips
 * the observation. Returns `undefined` when the lock could not be read at all,
 * so the caller keeps whatever the session already carried.
 */
export async function observeAndReadAccountLock(
  userId: string,
  headers: Headers | null,
  store: AccountLockStore,
  now: number = Date.now(),
): Promise<AccountGeoLock | undefined> {
  const hit = cache.get(userId)
  const cached = hit && hit.expiresAt > now ? hit.lock : undefined

  if (headers && cached !== ACCOUNT_FULL_BLOCK) {
    const state = await fullBlockStateOfNormalConnection(headers)
    if (state) {
      // The session is locked even if the write fails: this request IS in a
      // full-block state. The next request from there retries the write.
      try {
        await store.lock(userId, state)
        console.warn(`[geo] account locked: seen in ${state} on a normal connection (user ${userId}).`)
      } catch (e) {
        console.error(`[geo] account lock write failed (user ${userId}):`, e instanceof Error ? e.message : e)
      }
      remember(userId, ACCOUNT_FULL_BLOCK, now)
      return ACCOUNT_FULL_BLOCK
    }
  }

  if (cached !== undefined) return cached

  const read = await store.read(userId)
  if (read === undefined) return undefined
  remember(userId, read, now)
  return read
}
