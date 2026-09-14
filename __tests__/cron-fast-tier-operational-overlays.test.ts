import { describe, expect, it } from 'vitest'
import {
  FAST_TIER_OPERATIONAL_OVERLAYS,
  withFastTierOperationalOverlays,
} from '../scripts/cron-fast-tier-loop.mjs'

describe('fast-tier operational overlays', () => {
  it('schedules the active provider lane every five minutes without a Vercel cron entry', () => {
    expect(FAST_TIER_OPERATIONAL_OVERLAYS).toContainEqual({
      path: '/api/cron/fantasy-os-active-sync',
      schedule: '*/5 * * * *',
    })
    expect(withFastTierOperationalOverlays([])).toEqual(FAST_TIER_OPERATIONAL_OVERLAYS)
  })

  it('does not duplicate a route if it later becomes a native cron', () => {
    const native = {
      path: '/api/cron/fantasy-os-active-sync',
      schedule: '*/10 * * * *',
    }
    expect(withFastTierOperationalOverlays([native])).toEqual([native])
  })
})
