import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Nothing in the Survivor automation reached Sentry: failures went to `lastError`, a commissioner
 * alert, or a cron JSON summary. One helper now reports them all, with tags one alert rule can
 * filter on, and without re-reporting the same stuck league every minute.
 */

const capture = vi.hoisted(() => vi.fn())
vi.mock('@/lib/error-tracking', () => ({ captureException: capture }))

import {
  SURVIVOR_AUTOMATION_REPORT_WINDOW_MS,
  reportSurvivorAutomationError,
  resetSurvivorAutomationReportThrottle,
} from '@/lib/survivor/survivorAutomationReporting'
import { sentryTags } from '@/lib/error-tracking/sentry'

beforeEach(() => {
  capture.mockReset()
  resetSurvivorAutomationReportThrottle()
})

describe('reportSurvivorAutomationError', () => {
  it('reports with the tags an alert rule filters on', () => {
    const error = new Error('provider feed down')
    expect(reportSurvivorAutomationError(error, { job: 'season_runner', leagueId: 'lg-1', now: 0 })).toBe(true)
    expect(capture).toHaveBeenCalledWith(error, {
      context: 'survivor:season_runner',
      leagueId: 'lg-1',
      tags: { area: 'survivor', survivor_job: 'season_runner', league_id: 'lg-1' },
    })
  })

  it('a batch failure with no league is still tagged, and a non-Error is wrapped', () => {
    reportSurvivorAutomationError('timeout', { job: 'notifications', now: 0 })
    const [error, ctx] = capture.mock.calls[0]
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('timeout')
    expect(ctx.tags).toEqual({ area: 'survivor', survivor_job: 'notifications' })
  })

  it('the same failure on the same league reports once per window; a new message or league reports at once', () => {
    const run = (message: string, leagueId: string, now: number) => reportSurvivorAutomationError(new Error(message), { job: 'season_runner', leagueId, now })
    expect(run('down', 'lg-1', 0)).toBe(true)
    expect(run('down', 'lg-1', 60_000)).toBe(false)
    expect(run('a different error', 'lg-1', 60_000)).toBe(true)
    expect(run('down', 'lg-2', 60_000)).toBe(true)
    expect(run('down', 'lg-1', SURVIVOR_AUTOMATION_REPORT_WINDOW_MS)).toBe(true)
    expect(capture).toHaveBeenCalledTimes(4)
  })

  it('never throws, even when the reporter does', () => {
    capture.mockImplementation(() => { throw new Error('reporter down') })
    expect(() => reportSurvivorAutomationError(new Error('x'), { job: 'draft_start', now: 0 })).not.toThrow()
  })
})

describe('Sentry tags', () => {
  it('CaptureContext.tags become real Sentry tags; only non-empty strings pass', () => {
    expect(sentryTags({ tags: { area: 'survivor', survivor_job: 'draft_start', empty: '', n: 3 } })).toEqual({ area: 'survivor', survivor_job: 'draft_start' })
    expect(sentryTags({ context: 'app' })).toBeUndefined()
    expect(sentryTags(undefined)).toBeUndefined()
  })
})
