import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ACTION_TOKEN_TTL_SECONDS, signChimmyActionToken, verifyChimmyActionToken } from '@/lib/chimmy/actions/actionToken'
import type { ChimmyActionSpec } from '@/lib/chimmy/actions/types'

/**
 * The card's authority. A token that verifies after an edit, or after it expired, would let a card
 * be changed or kept for later — exactly what "signed, short-lived" exists to stop.
 */

const SPEC: ChimmyActionSpec = {
  kind: 'lineup',
  rosterId: 'r1',
  week: 4,
  season: 2026,
  moves: [
    { playerId: 'p-in', to: 'starters' },
    { playerId: 'p-out', to: 'bench' },
  ],
  baseFingerprint: 'fp',
}

const prev = { a: process.env.NEXTAUTH_SECRET, b: process.env.AUTH_SECRET }
beforeEach(() => {
  process.env.NEXTAUTH_SECRET = 'test-secret'
  delete process.env.AUTH_SECRET
})
afterEach(() => {
  if (prev.a === undefined) delete process.env.NEXTAUTH_SECRET
  else process.env.NEXTAUTH_SECRET = prev.a
  if (prev.b === undefined) delete process.env.AUTH_SECRET
  else process.env.AUTH_SECRET = prev.b
})

const NOW = new Date('2026-09-25T15:00:00Z')

describe('chimmy action token', () => {
  it('round-trips the exact spec for the user and league it was minted for', () => {
    const signed = signChimmyActionToken({ userId: 'u1', leagueId: 'L1', spec: SPEC, now: NOW })!
    const v = verifyChimmyActionToken(signed.token, NOW)
    expect(v).toMatchObject({ ok: true, payload: { userId: 'u1', leagueId: 'L1', spec: SPEC, actionId: signed.payload.actionId } })
  })

  it('gives every card its own action id', () => {
    const a = signChimmyActionToken({ userId: 'u1', leagueId: 'L1', spec: SPEC, now: NOW })!
    const b = signChimmyActionToken({ userId: 'u1', leagueId: 'L1', spec: SPEC, now: NOW })!
    expect(a.payload.actionId).not.toBe(b.payload.actionId)
  })

  it('refuses a card whose payload was edited — even one player id', () => {
    const signed = signChimmyActionToken({ userId: 'u1', leagueId: 'L1', spec: SPEC, now: NOW })!
    const [encoded, sig] = signed.token.split('.')
    const payload = JSON.parse(Buffer.from(encoded!, 'base64url').toString('utf8'))
    payload.spec.moves[0].playerId = 'someone-else'
    const forged = `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${sig}`
    expect(verifyChimmyActionToken(forged, NOW)).toEqual({ ok: false, reason: 'bad_signature' })
  })

  it('refuses a card minted under a different secret', () => {
    const signed = signChimmyActionToken({ userId: 'u1', leagueId: 'L1', spec: SPEC, now: NOW })!
    process.env.NEXTAUTH_SECRET = 'rotated'
    expect(verifyChimmyActionToken(signed.token, NOW)).toEqual({ ok: false, reason: 'bad_signature' })
  })

  it('expires after ten minutes', () => {
    const signed = signChimmyActionToken({ userId: 'u1', leagueId: 'L1', spec: SPEC, now: NOW })!
    expect(ACTION_TOKEN_TTL_SECONDS).toBe(600)
    const justBefore = new Date(NOW.getTime() + 599_000)
    const after = new Date(NOW.getTime() + 600_000)
    expect(verifyChimmyActionToken(signed.token, justBefore).ok).toBe(true)
    expect(verifyChimmyActionToken(signed.token, after)).toEqual({ ok: false, reason: 'expired' })
  })

  it('refuses garbage without throwing', () => {
    for (const t of [undefined, null, 42, '', 'abc', 'a.b.c', `${'x'.repeat(20_000)}.y`]) {
      expect(verifyChimmyActionToken(t, NOW).ok).toBe(false)
    }
  })

  it('makes no card at all when no signing secret is configured', () => {
    delete process.env.NEXTAUTH_SECRET
    expect(signChimmyActionToken({ userId: 'u1', leagueId: 'L1', spec: SPEC, now: NOW })).toBeNull()
    expect(verifyChimmyActionToken('a.b', NOW)).toEqual({ ok: false, reason: 'no_secret' })
  })
})
