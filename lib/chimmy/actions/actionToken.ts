import 'server-only'

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'

import { resolveAuthSecret } from '@/lib/auth/resolve-auth-secret'
import type { ChimmyActionSpec, ChimmyActionTokenPayload } from './types'

/**
 * The signed, short-lived token behind every Chimmy action card.
 *
 * ── WHY SIGNED, AND WHY NOTHING IS STORED AT PROPOSAL TIME ──────────────────────────────────────
 * The proposal tools run inside the model's tool loop, which must stay read-only: a card is built,
 * nothing is written. So the card has to carry its own authority, and that authority must be
 * something the browser cannot edit. An HMAC over the exact spec does both — change one player id
 * in the payload and the signature no longer verifies. Same construction and same key root as
 * `lib/league-trade-engine/proposalEvidenceToken.ts`, with its own key suffix so a token minted for
 * one purpose can never verify as the other.
 *
 * ⚠ SIGNING PROVES WHO MINTED IT, NOT THAT IT IS STILL TRUE. The confirm route re-validates the
 * whole move against live data (membership, ownership, locks, the league's own rules) and claims
 * the action id exactly once. A valid signature is necessary, never sufficient.
 */

export const ACTION_TOKEN_TTL_SECONDS = 10 * 60

function signingKey(): string | null {
  const secret = resolveAuthSecret()
  return secret ? `${secret}:chimmy-action:v1` : null
}

function sign(encoded: string, key: string): string {
  return createHmac('sha256', key).update(encoded).digest('base64url')
}

/** Null when no signing secret is configured — the caller must then refuse to offer a card. */
export function signChimmyActionToken(input: {
  userId: string
  leagueId: string
  spec: ChimmyActionSpec
  now?: Date
  actionId?: string
}): { token: string; payload: ChimmyActionTokenPayload } | null {
  const key = signingKey()
  if (!key) return null
  const nowSec = Math.floor((input.now ?? new Date()).getTime() / 1000)
  const payload: ChimmyActionTokenPayload = {
    v: 1,
    actionId: input.actionId ?? randomUUID(),
    userId: input.userId,
    leagueId: input.leagueId,
    exp: nowSec + ACTION_TOKEN_TTL_SECONDS,
    spec: input.spec,
  }
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return { token: `${encoded}.${sign(encoded, key)}`, payload }
}

export type VerifiedActionToken =
  | { ok: true; payload: ChimmyActionTokenPayload }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' | 'no_secret' }

function isSpec(value: unknown): value is ChimmyActionSpec {
  if (!value || typeof value !== 'object') return false
  const s = value as Record<string, unknown>
  if (s.kind === 'lineup') {
    return (
      typeof s.rosterId === 'string' &&
      typeof s.week === 'number' &&
      typeof s.season === 'number' &&
      typeof s.baseFingerprint === 'string' &&
      Array.isArray(s.moves) &&
      s.moves.every(
        (m) =>
          m &&
          typeof (m as Record<string, unknown>).playerId === 'string' &&
          ((m as Record<string, unknown>).to === 'starters' || (m as Record<string, unknown>).to === 'bench'),
      )
    )
  }
  if (s.kind === 'trade') {
    return (
      typeof s.proposerRosterId === 'string' &&
      typeof s.receiverRosterId === 'string' &&
      typeof s.week === 'number' &&
      typeof s.season === 'number' &&
      Array.isArray(s.assets) &&
      s.assets.every((a) => {
        const r = a as Record<string, unknown>
        return a && typeof r.playerId === 'string' && typeof r.fromRosterId === 'string' && typeof r.toRosterId === 'string'
      })
    )
  }
  return false
}

export function verifyChimmyActionToken(token: unknown, now: Date = new Date()): VerifiedActionToken {
  const key = signingKey()
  if (!key) return { ok: false, reason: 'no_secret' }
  if (typeof token !== 'string' || token.length > 16_000) return { ok: false, reason: 'malformed' }
  const [encoded, signature, extra] = token.split('.')
  if (!encoded || !signature || extra !== undefined) return { ok: false, reason: 'malformed' }

  const expected = Buffer.from(sign(encoded, key))
  const actual = Buffer.from(signature)
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return { ok: false, reason: 'bad_signature' }
  }

  let payload: ChimmyActionTokenPayload
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as ChimmyActionTokenPayload
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  if (
    !payload ||
    payload.v !== 1 ||
    typeof payload.actionId !== 'string' ||
    typeof payload.userId !== 'string' ||
    typeof payload.leagueId !== 'string' ||
    typeof payload.exp !== 'number' ||
    !isSpec(payload.spec)
  ) {
    return { ok: false, reason: 'malformed' }
  }
  if (payload.exp <= Math.floor(now.getTime() / 1000)) return { ok: false, reason: 'expired' }
  return { ok: true, payload }
}
