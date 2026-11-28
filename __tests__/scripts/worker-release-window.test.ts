import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BACKUP_GAP_H, WINDOW_END_MIN, WINDOW_START_MIN, decideScheduledAdvance } from '../../scripts/worker-release-window.mjs'

/*
 * 🛑 GitHub started the 21:20 UTC worker-release run at 01:48 UTC on 2026-11-22 and had not started the
 * next one by 23:17 the day after, so a fix sat unshipped all day. Three attempts in a quiet window,
 * once a day, and a late attempt stands down instead of redeploying the cron worker mid-game.
 */
const at = (iso: string) => new Date(iso)

describe('a scheduled worker-release attempt', () => {
  it('advances on time, inside the window, with nothing done yet today', () => {
    expect(decideScheduledAdvance(at('2026-11-24T13:21:00Z'), null).run).toBe(true)
  })

  it('a backup an hour later stands down once the first one succeeded', () => {
    const r = decideScheduledAdvance(at('2026-11-24T14:22:00Z'), at('2026-11-24T13:21:40Z'))
    expect(r.run).toBe(false)
    expect(r.line).toMatch(/already succeeded at 13:21/)
  })

  it('a backup still advances when the earlier attempts never ran (yesterday evening does not count)', () => {
    expect(decideScheduledAdvance(at('2026-11-24T15:25:00Z'), at('2026-11-23T23:17:31Z')).run).toBe(true)
  })

  it('a late start — the 2026-11-22 case, 4h28m late — does not deploy into the evening games', () => {
    const r = decideScheduledAdvance(at('2026-11-24T17:48:00Z'), null)
    expect(r.run).toBe(false)
    expect(r.line).toMatch(/outside the 13:00-16:30 UTC window/)
  })

  it('the window edges: 13:00 is in, 16:30 is out, 12:59 is out', () => {
    expect(decideScheduledAdvance(at('2026-11-24T13:00:00Z'), null).run).toBe(true)
    expect(decideScheduledAdvance(at('2026-11-24T16:29:59Z'), null).run).toBe(true)
    expect(decideScheduledAdvance(at('2026-11-24T16:30:00Z'), null).run).toBe(false)
    expect(decideScheduledAdvance(at('2026-11-24T12:59:00Z'), null).run).toBe(false)
  })

  it('an unreadable clock is not a reason to deploy', () => {
    expect(decideScheduledAdvance(new Date('nonsense'), null)).toEqual({ run: false, line: 'skip: could not read the current time' })
  })
})

describe('the workflow', () => {
  const yml = readFileSync(join(process.cwd(), '.github/workflows/worker-release.yml'), 'utf8')
  const crons = [...yml.matchAll(/^\s*- cron: "(\d+) (\d+) \* \* \*"/gm)].map((m) => Number(m[2]) * 60 + Number(m[1]))

  it('schedules three attempts, every one inside the window, an hour apart (more than the backup gap would allow two of)', () => {
    expect(crons).toHaveLength(3)
    for (const minute of crons) {
      expect(minute).toBeGreaterThanOrEqual(WINDOW_START_MIN)
      expect(minute).toBeLessThan(WINDOW_END_MIN)
    }
    // Every attempt falls within BACKUP_GAP_H of the first, so a success on time stops all the others.
    expect((Math.max(...crons) - Math.min(...crons)) / 60).toBeLessThan(BACKUP_GAP_H)
  })

  it('asks the script, and stands down by cancelling rather than succeeding', () => {
    expect(yml).toMatch(/node scripts\/worker-release-window\.mjs --now/)
    expect(yml).toMatch(/gh run cancel "\$GITHUB_RUN_ID"/)
    expect(yml).toMatch(/if: github\.event_name == 'schedule'/)
  })
})
