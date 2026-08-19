import { describe, it, expect } from 'vitest'
import { hostOf, resolveProdDbHost } from '@/scripts/check-staging-env-helpers'

describe('hostOf', () => {
  it('extracts the host from a postgres URL', () => {
    expect(hostOf('postgresql://user:pass@ep-spring-tooth.us-east-1.aws.neon.tech/db')).toBe(
      'ep-spring-tooth.us-east-1.aws.neon.tech',
    )
  })

  it('returns "" for a missing or unparseable URL', () => {
    expect(hostOf(undefined)).toBe('')
    expect(hostOf('not a url')).toBe('')
  })
})

describe('resolveProdDbHost', () => {
  it('prefers .env (base) over .env.local when both are set', () => {
    expect(
      resolveProdDbHost(
        'postgresql://u:p@ep-spring-tooth-adaoi9x1-pooler.c-2.us-east-1.aws.neon.tech/neondb',
        'postgresql://u:p@ep-curly-block-ad0dlt9o-pooler.c-2.us-east-1.aws.neon.tech/neondb',
      ),
    ).toBe('ep-spring-tooth-adaoi9x1-pooler.c-2.us-east-1.aws.neon.tech')
  })

  it('falls back to .env.local when .env has no DATABASE_URL', () => {
    expect(
      resolveProdDbHost(undefined, 'postgresql://u:p@ep-curly-block-ad0dlt9o-pooler.c-2.us-east-1.aws.neon.tech/neondb'),
    ).toBe('ep-curly-block-ad0dlt9o-pooler.c-2.us-east-1.aws.neon.tech')
  })

  it('returns "" when neither is set', () => {
    expect(resolveProdDbHost(undefined, undefined)).toBe('')
  })
})
