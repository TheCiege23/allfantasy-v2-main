import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import type { NextRequest } from 'next/server'
import { requireCronAuth } from '@/app/api/cron/_auth'

function makeRequest(headers: Record<string, string>): NextRequest {
  return {
    headers: {
      get: (key: string) => headers[key.toLowerCase()] ?? null,
    },
  } as unknown as NextRequest
}

const ENV_KEYS = ['CRON_SECRET', 'LEAGUE_CRON_SECRET', 'BRACKET_ADMIN_SECRET', 'ADMIN_PASSWORD', 'IMPORT_WORKER_SECRET'] as const

describe('requireCronAuth — production cron secret contract', () => {
  const original: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      original[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (original[key] === undefined) delete process.env[key]
      else process.env[key] = original[key]
    }
  })

  it('succeeds with a valid CRON_SECRET bearer token', () => {
    process.env.CRON_SECRET = 'real-secret'
    const req = makeRequest({ authorization: 'Bearer real-secret' })
    expect(requireCronAuth(req)).toBe(true)
  })

  it('returns false for an incorrect secret', () => {
    process.env.CRON_SECRET = 'real-secret'
    const req = makeRequest({ authorization: 'Bearer wrong-secret' })
    expect(requireCronAuth(req)).toBe(false)
  })

  it('fails closed when no cron secret is configured at all', () => {
    const req = makeRequest({ authorization: 'Bearer anything' })
    expect(requireCronAuth(req)).toBe(false)
  })

  it('fails closed when the request supplies no credential', () => {
    process.env.CRON_SECRET = 'real-secret'
    const req = makeRequest({})
    expect(requireCronAuth(req)).toBe(false)
  })

  // Regression for #289/#304: LEAGUE_CRON_SECRET used to be checked ahead of CRON_SECRET, so a
  // stale/placeholder LEAGUE_CRON_SECRET silently won and 401'd every real Vercel cron request
  // that correctly sent CRON_SECRET. CRON_SECRET must win by default now.
  it('does not let LEAGUE_CRON_SECRET shadow a correctly-configured CRON_SECRET', () => {
    process.env.CRON_SECRET = 'real-secret'
    process.env.LEAGUE_CRON_SECRET = 'placeholder-random-string'
    const req = makeRequest({ authorization: 'Bearer real-secret' })
    expect(requireCronAuth(req)).toBe(true)
  })

  it('still accepts LEAGUE_CRON_SECRET as a fallback when CRON_SECRET is unset', () => {
    process.env.LEAGUE_CRON_SECRET = 'legacy-secret'
    const req = makeRequest({ authorization: 'Bearer legacy-secret' })
    expect(requireCronAuth(req)).toBe(true)
  })

  it('honors an explicit preferredSecretEnv override ahead of both defaults', () => {
    process.env.CRON_SECRET = 'real-secret'
    process.env.WORLD_CUP_CRON_SECRET = 'wc-secret'
    const req = makeRequest({ authorization: 'Bearer wc-secret' })
    expect(requireCronAuth(req, 'WORLD_CUP_CRON_SECRET')).toBe(true)
    delete process.env.WORLD_CUP_CRON_SECRET
  })

  it('accepts the x-cron-secret header as well as a bearer token', () => {
    process.env.CRON_SECRET = 'real-secret'
    const req = makeRequest({ 'x-cron-secret': 'real-secret' })
    expect(requireCronAuth(req)).toBe(true)
  })
})
