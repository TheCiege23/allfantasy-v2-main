/**
 * A screen's read raises the league's trade alerts (trade system handoff, Phase 2: "When a user's
 * screen sees a new offer, claim and send it then, not only from the cron").
 *
 * What these pin is the part that makes it safe to call from every page view: one run per league
 * per minute across everyone, never a bootstrap, and a claim store that cannot be written means no
 * run at all rather than a notify pass per page view.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  claims: new Set<string>(),
  createFails: null as null | { code?: string },
  notify: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsDataCache: {
      create: async ({ data }: { data: { cacheKey: string } }) => {
        if (h.createFails) throw Object.assign(new Error('store'), h.createFails)
        if (h.claims.has(data.cacheKey)) throw Object.assign(new Error('unique'), { code: 'P2002' })
        h.claims.add(data.cacheKey)
        return {}
      },
    },
  },
}))
vi.mock('@/lib/trade-intel/tradeNotifyService', () => ({ detectAndNotifyLeague: h.notify }))

import { alertFromScreenRead, SCREEN_ALERT_WINDOW_MS, triggerAlertFromScreenRead } from '@/lib/trade-intel/screenTradeAlerts'

const T0 = Date.parse('2026-09-26T05:00:00Z')

beforeEach(() => {
  h.claims.clear()
  h.createFails = null
  h.notify.mockReset()
  h.notify.mockResolvedValue({ sleeperLeagueId: 'SL1', checked: true })
  delete process.env.TRADE_ALERT_FROM_SCREEN_DISABLED
})

describe('alertFromScreenRead', () => {
  it('runs the slice notify on the current weeks — and never bootstraps', async () => {
    expect(await alertFromScreenRead('SL1', [2, 3, 4], T0)).toBe('ran')
    expect(h.notify).toHaveBeenCalledWith('SL1', { weeks: [2, 3, 4], bootstrapBudget: { left: 0 } })
  })

  it('🛑 once per league per minute, however many screens read it', async () => {
    const outcomes = await Promise.all(Array.from({ length: 10 }, () => alertFromScreenRead('SL1', [3], T0 + 1_000)))
    expect(outcomes.filter((o) => o === 'ran')).toHaveLength(1)
    expect(outcomes.filter((o) => o === 'throttled')).toHaveLength(9)
    expect(h.notify).toHaveBeenCalledTimes(1)
    // Another league is its own throttle; the next minute is a new one.
    expect(await alertFromScreenRead('SL2', [3], T0)).toBe('ran')
    expect(await alertFromScreenRead('SL1', [3], T0 + SCREEN_ALERT_WINDOW_MS)).toBe('ran')
  })

  it('🛑 a claim store that cannot be written runs NOTHING — fail closed', async () => {
    h.createFails = { code: 'P1001' }
    expect(await alertFromScreenRead('SL1', [3], T0)).toBe('failed')
    expect(h.notify).not.toHaveBeenCalled()
  })

  it('no current weeks, no league id, or the kill switch: skipped, nothing claimed', async () => {
    expect(await alertFromScreenRead('SL1', [], T0)).toBe('skipped')
    expect(await alertFromScreenRead('  ', [3], T0)).toBe('skipped')
    process.env.TRADE_ALERT_FROM_SCREEN_DISABLED = '1'
    expect(await alertFromScreenRead('SL1', [3], T0)).toBe('skipped')
    expect(h.claims.size).toBe(0)
    expect(h.notify).not.toHaveBeenCalled()
  })

  it('a notify pass that throws never reaches the page', async () => {
    h.notify.mockImplementation(async () => Promise.reject(new Error('boom')))
    expect(await alertFromScreenRead('SL1', [3], T0)).toBe('failed')
    await expect(triggerAlertFromScreenRead('SL3', [3])).resolves.toBe('failed')
  })
})
