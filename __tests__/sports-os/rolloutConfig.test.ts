import { describe, expect, it } from 'vitest'
import { DEFAULT_ROLLOUTS, isEnabled } from '@/lib/sports-os/rollout'
import { resolveRollouts, ROLLOUT_ENV_OVERRIDES } from '@/lib/sports-os/rolloutConfig'

const SUBJECTS = Array.from({ length: 200 }, (_, i) => `user_${i}`)

describe('resolveRollouts', () => {
  it('returns the code defaults when no override is set', () => {
    expect(resolveRollouts({})).toEqual(DEFAULT_ROLLOUTS)
  })

  it('serves screen summaries and league invalidation to everyone by default', () => {
    const rules = resolveRollouts({})
    expect(SUBJECTS.every((s) => isEnabled('sports-os.screen-summaries', s, rules))).toBe(true)
    expect(SUBJECTS.every((s) => isEnabled('sports-os.reaction-invalidation', s, rules))).toBe(true)
    // Enqueueing stays off: it loads the single-threaded worker and has not been measured.
    expect(SUBJECTS.some((s) => isEnabled('sports-os.ingest-reactions', s, rules))).toBe(false)
  })

  it('pulls a flag back with `off` — the incident switch', () => {
    const rules = resolveRollouts({ SPORTS_OS_SCREEN_SUMMARIES_ROLLOUT: 'off' })
    expect(SUBJECTS.some((s) => isEnabled('sports-os.screen-summaries', s, rules))).toBe(false)
    // Other flags are untouched.
    expect(rules['sports-os.reaction-invalidation']).toEqual(DEFAULT_ROLLOUTS['sports-os.reaction-invalidation'])
  })

  it('narrows a flag to a percentage', () => {
    const rules = resolveRollouts({ SPORTS_OS_SCREEN_SUMMARIES_ROLLOUT: '10' })
    const on = SUBJECTS.filter((s) => isEnabled('sports-os.screen-summaries', s, rules)).length
    expect(on).toBeGreaterThan(0)
    expect(on).toBeLessThan(SUBJECTS.length / 2)
  })

  it('keeps the code default on an unparseable value rather than switching off', () => {
    const rules = resolveRollouts({ SPORTS_OS_SCREEN_SUMMARIES_ROLLOUT: 'tenpercent' })
    expect(rules['sports-os.screen-summaries']).toEqual(DEFAULT_ROLLOUTS['sports-os.screen-summaries'])
  })

  it('only maps flags that exist in the default table', () => {
    for (const flag of Object.keys(ROLLOUT_ENV_OVERRIDES)) expect(DEFAULT_ROLLOUTS[flag], flag).toBeDefined()
  })
})
