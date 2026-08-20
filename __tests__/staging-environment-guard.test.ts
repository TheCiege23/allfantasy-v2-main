import { describe, expect, it } from 'vitest'
import { assessStagingEnvironment } from '@/lib/scoring/staging-environment-guard'

describe('staging-environment-guard', () => {
  it('confirms staging when database and app env both signal staging', () => {
    const result = assessStagingEnvironment({
      DATABASE_URL: 'postgresql://u:p@db-staging.example.com:5432/staging_db',
      APP_ENV: 'staging',
      NODE_ENV: 'development',
      VERCEL_ENV: 'preview',
    })
    expect(result.confirmed).toBe(true)
    expect(result.notes).toHaveLength(0)
  })

  it('rejects when production signals are present', () => {
    const result = assessStagingEnvironment({
      DATABASE_URL: 'postgresql://u:p@db-prod.example.com:5432/prod_db',
      APP_ENV: 'production',
      NODE_ENV: 'production',
      VERCEL_ENV: 'production',
    })
    expect(result.confirmed).toBe(false)
    expect(result.notes).toContain('production_signal_present')
  })

  it('rejects when no explicit staging signal exists', () => {
    const result = assessStagingEnvironment({
      DATABASE_URL: 'postgresql://u:p@ep-curly-block-ad0dlt9o-pooler.c-2.us-east-1.aws.neon.tech:5432/neondb',
      NODE_ENV: 'development',
      VERCEL_ENV: '',
      APP_ENV: '',
    })
    expect(result.confirmed).toBe(false)
    expect(result.notes).toContain('no_positive_staging_signal')
  })
})
