import { describe, expect, it } from 'vitest'
import {
  EXCLUDE_STORE_TEST_SUBSCRIPTIONS,
  EXCLUDE_STORE_TEST_SUBSCRIPTIONS_SQL,
  STORE_TEST_ENVIRONMENTS,
} from '@/lib/monetization/storeTestSubscriptions'

describe('store test subscriptions are left out of subscriber counts', () => {
  it('names every non-production Apple environment, and never Production', () => {
    expect([...STORE_TEST_ENVIRONMENTS].sort()).toEqual(['LocalTesting', 'Sandbox', 'Xcode'])
    expect(STORE_TEST_ENVIRONMENTS).not.toContain('Production')
  })

  it('only ever excludes Apple rows', () => {
    const not = EXCLUDE_STORE_TEST_SUBSCRIPTIONS.NOT as { source: string; OR: unknown[] }
    expect(not.source).toBe('apple')
    expect(not.OR).toEqual(
      STORE_TEST_ENVIRONMENTS.map((env) => ({ metadata: { path: ['environment'], equals: env } })),
    )
  })

  it('applies the same rule in raw SQL', () => {
    expect(EXCLUDE_STORE_TEST_SUBSCRIPTIONS_SQL.sql).toContain(`"source" = 'apple'`)
    expect(EXCLUDE_STORE_TEST_SUBSCRIPTIONS_SQL.values).toEqual([...STORE_TEST_ENVIRONMENTS])
  })
})
