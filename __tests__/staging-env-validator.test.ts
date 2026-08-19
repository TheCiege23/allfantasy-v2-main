/**
 * Staging env safety validator tests.
 *
 * Locks the safety rules: live Stripe → error, missing cron secret → error,
 * production-looking DB → error (unless allowed), and the CRON/ADMIN mismatch
 * being informational (the redraft crons now accept CRON_SECRET).
 */
import { describe, expect, it } from 'vitest'
import { validateStagingEnv } from '@/lib/staging/validateStagingEnv'

const base: Record<string, string> = {
  STRIPE_SECRET_KEY: 'sk_test_abc',
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_test_abc',
  STRIPE_WEBHOOK_SECRET: 'whsec_abc',
  CRON_SECRET: 'cron-123',
  ADMIN_PASSWORD: 'admin-456',
  DATABASE_URL: 'postgres://u:p@staging-host/neondb_staging',
  PLAYWRIGHT_BASE_URL: 'http://localhost:3010',
  NEXTAUTH_SECRET: 'shh',
}

describe('validateStagingEnv', () => {
  it('passes a clean staging config (test stripe, cron secret, staging db)', () => {
    const r = validateStagingEnv(base)
    expect(r.ok).toBe(true)
    expect(r.errors).toEqual([])
  })

  it('FAILS on live Stripe keys', () => {
    const r = validateStagingEnv({ ...base, STRIPE_SECRET_KEY: 'sk_live_xxx' })
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => /LIVE/.test(e))).toBe(true)
  })

  it('allows live Stripe only with --allow-live-stripe, as a loud warning', () => {
    const r = validateStagingEnv({ ...base, STRIPE_SECRET_KEY: 'sk_live_xxx' }, { allowLiveStripe: true })
    expect(r.ok).toBe(true)
    expect(r.warnings.some((w) => /REAL CHARGES/i.test(w))).toBe(true)
  })

  it('FAILS when CRON_SECRET (and LEAGUE_CRON_SECRET) are missing', () => {
    const { CRON_SECRET, ...noCron } = base
    void CRON_SECRET
    const r = validateStagingEnv(noCron)
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => /CRON_SECRET/.test(e))).toBe(true)
  })

  it('treats CRON_SECRET != ADMIN_PASSWORD as informational (not an error)', () => {
    const r = validateStagingEnv(base) // they differ in `base`
    expect(r.ok).toBe(true)
    expect(r.info.some((i) => /CRON_SECRET != ADMIN_PASSWORD/.test(i))).toBe(true)
  })

  it('FAILS when DATABASE_URL does not look like staging', () => {
    const r = validateStagingEnv({ ...base, DATABASE_URL: 'postgres://u:p@ep-spring-tooth.aws.neon.tech/neondb' })
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => /staging database/i.test(e))).toBe(true)
  })

  it('passes a Neon branch URL (no staging marker) when its host differs from the production host', () => {
    const r = validateStagingEnv(
      { ...base, DATABASE_URL: 'postgresql://u:p@ep-winter-salad-ad34lce8-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require' },
      { prodDbHost: 'ep-spring-tooth-adaoi9x1.c-2.us-east-1.aws.neon.tech' },
    )
    expect(r.ok).toBe(true)
    expect(r.errors).toEqual([])
    expect(r.info.some((i) => /differs from the production host/.test(i))).toBe(true)
  })

  it('FAILS when DATABASE_URL host MATCHES the known production host', () => {
    const prod = 'ep-spring-tooth-adaoi9x1.c-2.us-east-1.aws.neon.tech'
    const r = validateStagingEnv(
      { ...base, DATABASE_URL: `postgresql://u:p@${prod}/neondb?sslmode=require` },
      { prodDbHost: prod },
    )
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => /MATCHES the production database host/i.test(e))).toBe(true)
  })

  it('allows a prod-looking DB only with --allow-prod-db, as a warning', () => {
    const r = validateStagingEnv({ ...base, DATABASE_URL: 'postgres://u:p@prod.aws.neon.tech/neondb' }, { allowProdDb: true })
    expect(r.ok).toBe(true)
    expect(r.warnings.some((w) => /PRODUCTION/.test(w))).toBe(true)
  })

  it('FAILS when DATABASE_URL is missing', () => {
    const { DATABASE_URL, ...noDb } = base
    void DATABASE_URL
    expect(validateStagingEnv(noDb).ok).toBe(false)
  })

  it('warns (not fails) when STRIPE_WEBHOOK_SECRET or app URL is missing', () => {
    const { STRIPE_WEBHOOK_SECRET, PLAYWRIGHT_BASE_URL, ...partial } = base
    void STRIPE_WEBHOOK_SECRET
    void PLAYWRIGHT_BASE_URL
    const r = validateStagingEnv(partial)
    expect(r.ok).toBe(true) // these are warnings, not blockers
    expect(r.warnings.some((w) => /STRIPE_WEBHOOK_SECRET/.test(w))).toBe(true)
    expect(r.warnings.some((w) => /app URL/i.test(w))).toBe(true)
  })

  it('strips surrounding quotes from values (env-file quoting)', () => {
    const r = validateStagingEnv({ ...base, STRIPE_SECRET_KEY: '"sk_live_quoted"' })
    expect(r.errors.some((e) => /LIVE/.test(e))).toBe(true)
  })
})
