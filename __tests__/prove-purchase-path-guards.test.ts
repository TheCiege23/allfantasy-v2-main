import { describe, expect, it } from 'vitest'

import {
  OUTBOUND_ENV_KEYS,
  dbHost,
  pickEnv,
  refuseUnlessSafe,
} from '../scripts/prove-purchase-path.guards'

/*
 * scripts/prove-purchase-path.ts runs a purchase end to end. These are the refusals that keep it
 * from ever doing that against live Stripe or the production database, and the tokens it pins empty
 * so the checkout webhook's Meta "Purchase" conversion — which cannot be taken back — never fires.
 */

const TEST_DB = 'postgresql://u:p@ep-muddy-leaf-adigvvph-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require'
const PROD_DB = 'postgresql://u:p@ep-curly-block-ad0dlt9o-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require'
const SANDBOX_KEY = `sk_test_${'x'.repeat(24)}`
const LIVE_KEY = `sk_live_${'x'.repeat(24)}`

describe('prove-purchase-path refusals', () => {
  it('runs with a sandbox key and the test database', () => {
    expect(refuseUnlessSafe({ stripeSecretKey: SANDBOX_KEY, databaseUrl: TEST_DB })).toBeNull()
  })

  it('🛑 refuses a live Stripe key', () => {
    expect(refuseUnlessSafe({ stripeSecretKey: LIVE_KEY, databaseUrl: TEST_DB })).toMatch(/not a test-mode key/)
    expect(refuseUnlessSafe({ stripeSecretKey: `rk_live_${'x'.repeat(24)}`, databaseUrl: TEST_DB })).toMatch(/not a test-mode key/)
  })

  it('🛑 refuses the production database — .env.local pairs a test key with it', () => {
    expect(refuseUnlessSafe({ stripeSecretKey: SANDBOX_KEY, databaseUrl: PROD_DB })).toMatch(/production database \(ep-curly-block/)
  })

  it('refuses when either is missing', () => {
    expect(refuseUnlessSafe({ stripeSecretKey: '', databaseUrl: TEST_DB })).toMatch(/No Stripe key/)
    expect(refuseUnlessSafe({ stripeSecretKey: SANDBOX_KEY, databaseUrl: '' })).toMatch(/No DATABASE_URL/)
  })

  it('reads the host out of a connection string', () => {
    expect(dbHost(PROD_DB)).toBe('ep-curly-block-ad0dlt9o-pooler.c-2.us-east-1.aws.neon.tech')
    expect(dbHost('postgresql://localhost:5432/db')).toBe('localhost')
    expect(dbHost(null)).toBeNull()
  })

  it('picks ONLY the keys asked for out of an env file', () => {
    const text = [
      'STRIPE_SECRET_KEY="sk_test_abc"',
      'DATABASE_URL=postgresql://prod',
      'META_CONVERSIONS_API_TOKEN=secret',
      '# comment',
    ].join('\n')
    expect(pickEnv(text, ['STRIPE_SECRET_KEY'])).toEqual({ STRIPE_SECRET_KEY: 'sk_test_abc' })
  })

  it('pins the Meta conversion token, email and SMS tokens empty', () => {
    for (const key of ['META_CONVERSIONS_API_TOKEN', 'RESEND_API_KEY', 'TWILIO_AUTH_TOKEN']) {
      expect(OUTBOUND_ENV_KEYS).toContain(key)
    }
  })
})
