import { describe, expect, it } from 'vitest'
import { dueAt, loadSchedule, matches, parseCron } from '../scripts/cron-runner.mjs'

// The runner replaces Vercel's scheduler for cron-schedule.json, so the one
// thing that must be right is "which jobs are due at this UTC minute". These
// pin the parser against the shapes that file actually uses, plus a negative
// control so a broken parser cannot pass by matching nothing.

const at = (iso: string) => new Date(iso)

describe('cron-runner schedule parsing', () => {
  it('parses every schedule committed in cron-schedule.json', () => {
    const jobs = loadSchedule()
    expect(jobs.length).toBeGreaterThan(40)
    for (const job of jobs) expect(job.parsed.fields).toHaveLength(5)
  })

  it('rejects malformed expressions instead of silently never firing', () => {
    expect(() => parseCron('*/5 * * *')).toThrow(/expected 5 fields/)
    expect(() => parseCron('61 * * * *')).toThrow(/outside 0-59/)
    expect(() => parseCron('*/0 * * * *')).toThrow(/non-positive step/)
    expect(() => parseCron('5-1 * * * *')).toThrow(/reversed range/)
  })

  it('every minute / every N minutes', () => {
    const every = parseCron('* * * * *')
    expect(matches(every, at('2026-09-02T19:37:00Z'))).toBe(true)

    const five = parseCron('*/5 * * * *')
    expect(matches(five, at('2026-09-02T19:05:00Z'))).toBe(true)
    expect(matches(five, at('2026-09-02T19:07:00Z'))).toBe(false)
    expect(matches(five, at('2026-09-02T19:00:00Z'))).toBe(true)
  })

  it('lists, hour steps, and hour ranges', () => {
    const quarter = parseCron('15,45 * * * *')
    expect(matches(quarter, at('2026-09-02T03:15:00Z'))).toBe(true)
    expect(matches(quarter, at('2026-09-02T03:30:00Z'))).toBe(false)

    const sixHourly = parseCron('10 */6 * * *')
    expect(matches(sixHourly, at('2026-09-02T06:10:00Z'))).toBe(true)
    expect(matches(sixHourly, at('2026-09-02T07:10:00Z'))).toBe(false)
    expect(matches(sixHourly, at('2026-09-02T06:11:00Z'))).toBe(false)

    const afternoons = parseCron('0 16-19 * * *')
    expect(matches(afternoons, at('2026-09-02T17:00:00Z'))).toBe(true)
    expect(matches(afternoons, at('2026-09-02T20:00:00Z'))).toBe(false)
  })

  it('day-of-week uses UTC and 7 means Sunday', () => {
    // 2026-09-07 is a Monday; 2026-09-08 a Tuesday; 2026-09-06 a Sunday.
    const monday = parseCron('0 11 * * 1')
    expect(matches(monday, at('2026-09-07T11:00:00Z'))).toBe(true)
    expect(matches(monday, at('2026-09-08T11:00:00Z'))).toBe(false)

    const sunday7 = parseCron('0 0 * * 7')
    expect(matches(sunday7, at('2026-09-06T00:00:00Z'))).toBe(true)
    expect(matches(sunday7, at('2026-09-07T00:00:00Z'))).toBe(false)
  })

  it('dueAt returns the jobs Vercel would have fired at that minute', () => {
    const jobs = loadSchedule()
    const due = dueAt(jobs, at('2026-09-02T19:05:00Z')).map((j) => j.path)
    expect(due).toContain('/api/cron/waivers')
    expect(due).toContain('/api/cron/notification-outbox-relay')
    expect(due).toContain('/api/cron/draft-tick')
    expect(due).not.toContain('/api/cron/import-players') // 0 */6 — not at :05

    const sixAm = dueAt(jobs, at('2026-09-02T06:00:00Z')).map((j) => j.path)
    expect(sixAm).toContain('/api/cron/import-players')
    expect(sixAm).toContain('/api/cron/decision-os-activity-ingest?relayOnly=1')
  })
})
