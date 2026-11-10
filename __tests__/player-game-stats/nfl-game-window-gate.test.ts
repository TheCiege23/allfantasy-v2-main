/**
 * The NFL week-stats import's game-window gate (2026-11-09). The route fires hourly through the NFL
 * windows; only a fire inside a game window, the first in 20 hours, or an explicit call does work.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DAILY_FLOOR_MS, decideNflStatsRun, LIVE_WINDOW_MS } from '@/lib/player-game-stats/nflGameWindowGate'
import { allowanceFor, maxGapMs, PROBES } from '../../scripts/cron-freshness-check.mjs'

const now = new Date('2026-11-08T20:40:00Z') // a Sunday, mid-afternoon ET
const ago = (ms: number) => new Date(now.getTime() - ms)
const H = 60 * 60 * 1000

describe('decideNflStatsRun', () => {
  it('runs inside a game window: a kickoff within the last five hours', () => {
    expect(decideNflStatsRun({ now, explicit: false, latestKickoff: ago(2 * H), lastSuccessAt: ago(1 * H) })).toEqual({ run: true, reason: 'game' })
    expect(decideNflStatsRun({ now, explicit: false, latestKickoff: ago(LIVE_WINDOW_MS), lastSuccessAt: ago(1 * H) }).run).toBe(true)
  })

  it('skips between windows once the daily run has happened', () => {
    expect(decideNflStatsRun({ now, explicit: false, latestKickoff: ago(LIVE_WINDOW_MS + 1), lastSuccessAt: ago(3 * H) })).toEqual({ run: false, reason: 'no_game_window' })
    expect(decideNflStatsRun({ now, explicit: false, latestKickoff: null, lastSuccessAt: ago(3 * H) }).run).toBe(false)
  })

  it('keeps the once-a-day import, even when the scheduler delays the 06:40 fire', () => {
    expect(decideNflStatsRun({ now, explicit: false, latestKickoff: null, lastSuccessAt: ago(DAILY_FLOOR_MS) })).toEqual({ run: true, reason: 'daily' })
    expect(decideNflStatsRun({ now, explicit: false, latestKickoff: null, lastSuccessAt: ago(DAILY_FLOOR_MS - 1) }).run).toBe(false)
  })

  it('treats an unknown last run as due — a failed read must never stop the import', () => {
    expect(decideNflStatsRun({ now, explicit: false, latestKickoff: null, lastSuccessAt: null })).toEqual({ run: true, reason: 'daily' })
  })

  it('always runs an explicit call (season, week, cap, dry run), as before', () => {
    expect(decideNflStatsRun({ now, explicit: true, latestKickoff: null, lastSuccessAt: ago(1 * H) })).toEqual({ run: true, reason: 'explicit' })
  })
})

describe('the schedule and the monitors agree with the gate', () => {
  const schedule = JSON.parse(readFileSync(join(process.cwd(), 'cron-schedule.json'), 'utf8')).crons as Array<{ path: string; schedule: string }>
  const nfl = schedule.find((c) => c.path === '/api/cron/import-player-game-stats')

  it('fires hourly through the NFL windows, and still at 06:40', () => {
    expect(nfl?.schedule).toBe('40 0-6,13-23 * * *')
  })

  it('is fired by the slow-tier workflow', () => {
    const workflow = readFileSync(join(process.cwd(), '.github/workflows/cron-slow-tier.yml'), 'utf8')
    expect(workflow).toContain('- cron: "40 0-6,13-23 * * *"')
    expect(workflow).not.toContain('- cron: "40 6 * * *"')
  })

  it('keeps the freshness probe at the once-a-day allowance, not the hourly schedule’s', () => {
    const probe = (PROBES as Record<string, { minAllowanceMs?: number }>)['/api/cron/import-player-game-stats']
    const fromSchedule = allowanceFor(maxGapMs(nfl!.schedule))
    expect(fromSchedule).toBeLessThan(24 * H)
    expect(allowanceFor(maxGapMs(nfl!.schedule), probe)).toBe(48 * H)
  })
})
