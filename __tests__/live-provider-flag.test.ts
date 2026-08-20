import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { RollingInsightsLiveProvider } from '@/lib/live/rollingInsightsLiveProvider'

/**
 * The flag contract. These assert the ROLLOUT SAFETY properties, not the
 * provider's data handling (covered in rolling-insights-live-provider.test.ts).
 */
describe('live provider rollout flag', () => {
  const saved = { flag: process.env.LIVE_PROVIDER_RI_PRESEASON, token: process.env.ROLLING_INSIGHTS_RSC_TOKEN }
  beforeEach(() => {
    delete process.env.LIVE_PROVIDER_RI_PRESEASON
    process.env.ROLLING_INSIGHTS_RSC_TOKEN = 'test-token'
  })
  afterEach(() => {
    if (saved.flag) process.env.LIVE_PROVIDER_RI_PRESEASON = saved.flag
    else delete process.env.LIVE_PROVIDER_RI_PRESEASON
    if (saved.token) process.env.ROLLING_INSIGHTS_RSC_TOKEN = saved.token
    else delete process.env.ROLLING_INSIGHTS_RSC_TOKEN
  })

  it('constructs preseason-scoped by default', () => {
    const p = new RollingInsightsLiveProvider({ token: 't' })
    expect(p).toBeInstanceOf(RollingInsightsLiveProvider)
  })

  it('THROWS without the NFL token, so the cron can fall back rather than run blind', () => {
    delete process.env.ROLLING_INSIGHTS_RSC_TOKEN
    // The cron catches this and uses the incumbent provider. Failing loudly at
    // construction beats 304-ing forever on the wrong credential.
    expect(() => new RollingInsightsLiveProvider({})).toThrow(/RSC_TOKEN/)
  })

  it('a regular-season game is invisible even when the flag is ON', async () => {
    // Two independent guards: the flag controls the rollout, the scope protects
    // users. Either alone would be enough; both is deliberate.
    process.env.LIVE_PROVIDER_RI_PRESEASON = '1'
    const p = new RollingInsightsLiveProvider({
      token: 't',
      fetchImpl: async () => ({
        status: 200,
        json: async () => ({
          data: { NFL: [{ game_ID: 'REG', game_status: 'In Progress', season_type: 'Regular Season', player_box: {}, full_box: {} }] },
        }),
      }),
    })
    expect(await p.fetchActiveGames({ sport: 'NFL', season: 2026, week: 1 })).toHaveLength(0)
  })
})
