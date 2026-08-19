/**
 * Regression guard for the Twilio config bug that reached production.
 *
 * An API Key SID (`SK…`) was set as TWILIO_ACCOUNT_SID. Every env var was present, so the
 * presence-only health check reported `canUseRawSms: true` / `canUseVerify: true` while
 * `getTwilioClient()` threw on every call — taking phone signup and SMS password reset with it.
 * The check that existed to catch this reported success instead.
 *
 * These tests assert the status is FORMAT-aware, not presence-aware.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const REAL_ACCOUNT_SID = 'AC00000000000000000000000000000000'
const REAL_API_KEY = 'SK00000000000000000000000000000000'
const REAL_VERIFY_SID = 'VA00000000000000000000000000000000'

async function loadStatus() {
  vi.resetModules()
  const mod = await import('@/lib/twilio-client')
  return mod.getTwilioRuntimeStatus()
}

const ENV_KEYS = [
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_API_KEY',
  'TWILIO_API_SECRET',
  'TWILIO_PHONE_NUMBER',
  'TWILIO_VERIFY_SERVICE_SID',
] as const

let saved: Record<string, string | undefined> = {}

beforeEach(() => {
  saved = {}
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('getTwilioRuntimeStatus — format awareness', () => {
  it('reports healthy when every SID is the right type (auth-token mode)', async () => {
    process.env.TWILIO_ACCOUNT_SID = REAL_ACCOUNT_SID
    process.env.TWILIO_AUTH_TOKEN = 'some-auth-token'
    process.env.TWILIO_PHONE_NUMBER = '+13615550100'
    process.env.TWILIO_VERIFY_SERVICE_SID = REAL_VERIFY_SID

    const s = await loadStatus()
    expect(s.accountSidWellFormed).toBe(true)
    expect(s.canUseAuthTokenMode).toBe(true)
    expect(s.canUseRawSms).toBe(true)
    expect(s.canUseVerify).toBe(true)
  })

  it('THE PRODUCTION BUG: an API Key SID in TWILIO_ACCOUNT_SID must NOT report usable', async () => {
    // Exactly the shipped misconfiguration: every var present, SID is an SK not an AC.
    process.env.TWILIO_ACCOUNT_SID = REAL_API_KEY // <- SK where AC belongs
    process.env.TWILIO_AUTH_TOKEN = 'some-auth-token'
    process.env.TWILIO_API_KEY = REAL_API_KEY
    process.env.TWILIO_API_SECRET = 'some-secret'
    process.env.TWILIO_PHONE_NUMBER = '+13615550100'
    process.env.TWILIO_VERIFY_SERVICE_SID = REAL_VERIFY_SID

    const s = await loadStatus()

    // Presence is still honestly reported...
    expect(s.hasAccountSid).toBe(true)
    // ...but nothing may claim to be usable, because the client cannot be built.
    expect(s.accountSidWellFormed).toBe(false)
    expect(s.canUseAuthTokenMode).toBe(false)
    expect(s.canUseApiKeyMode).toBe(false)
    expect(s.canUseRawSms).toBe(false)
    expect(s.canUseVerify).toBe(false)
  })

  it('rejects a Verify Service SID that is not a VA', async () => {
    process.env.TWILIO_ACCOUNT_SID = REAL_ACCOUNT_SID
    process.env.TWILIO_AUTH_TOKEN = 'some-auth-token'
    process.env.TWILIO_VERIFY_SERVICE_SID = REAL_ACCOUNT_SID // AC where VA belongs

    const s = await loadStatus()
    expect(s.hasVerifyServiceSid).toBe(true)
    expect(s.verifyServiceSidWellFormed).toBe(false)
    expect(s.canUseVerify).toBe(false)
  })

  it('does not claim api_key mode when TWILIO_API_KEY is not an SK', async () => {
    process.env.TWILIO_ACCOUNT_SID = REAL_ACCOUNT_SID
    process.env.TWILIO_API_KEY = REAL_ACCOUNT_SID // AC where SK belongs
    process.env.TWILIO_API_SECRET = 'some-secret'

    const s = await loadStatus()
    expect(s.apiKeyWellFormed).toBe(false)
    expect(s.canUseApiKeyMode).toBe(false)
  })

  it('reports not-configured when nothing is set', async () => {
    const s = await loadStatus()
    expect(s.canUseRawSms).toBe(false)
    expect(s.canUseVerify).toBe(false)
  })
})

describe('getTwilioClient — diagnosis quality', () => {
  it('names the swapped var instead of surfacing Twilio\'s generic error', async () => {
    process.env.TWILIO_ACCOUNT_SID = REAL_API_KEY
    process.env.TWILIO_API_KEY = REAL_API_KEY
    process.env.TWILIO_API_SECRET = 'some-secret'

    vi.resetModules()
    const { getTwilioClient } = await import('@/lib/twilio-client')
    expect(() => getTwilioClient()).toThrow(/belongs in TWILIO_API_KEY/)
  })
})
