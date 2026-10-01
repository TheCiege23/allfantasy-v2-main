// @vitest-environment node
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { compileCron, dueSchedules, parseField } from '../../scripts/cron-scheduler.mjs'
import { classifyCrons, readCronSchedule, slowTierSchedules } from '../../scripts/cron-tier.mjs'
import { withFastTierOperationalOverlays } from '../../scripts/cron-fast-tier-loop.mjs'

/*
 * scripts/cron-scheduler.mjs moves the crons from GitHub Actions to a Railway service. The ways
 * that move can go wrong WITHOUT anything erroring:
 *   - a cron expression parsed slightly differently from GitHub's fires at the wrong times;
 *   - the Railway service fires a different SET of schedules than the workflow did;
 *   - the image is missing a script or a route file, and the fast loop quietly falls back to
 *     default timeouts.
 * Each has a test below.
 */

const utc = (s: string) => new Date(`${s}Z`)
const matches = (expr: string, at: string) => compileCron(expr)(utc(at))

describe('cron expression matching (UTC, like GitHub)', () => {
  it('parses the field forms the schedule uses', () => {
    expect([...parseField('*/15', 0, 59)]).toEqual([0, 15, 30, 45])
    expect([...parseField('15,45', 0, 59)]).toEqual([15, 45])
    expect([...parseField('16-19', 0, 23)]).toEqual([16, 17, 18, 19])
    expect([...parseField('3,9', 0, 23)]).toEqual([3, 9])
    expect([...parseField('10-30/10', 0, 59)]).toEqual([10, 20, 30])
    expect(() => parseField('*/0', 0, 59)).toThrow()
    expect(() => parseField('61', 0, 59)).toThrow()
    expect(() => parseField('L', 0, 59)).toThrow()
  })

  it('matches minute, hour, ranges, steps and lists', () => {
    expect(matches('0 16-19 * * *', '2026-10-01T17:00:00')).toBe(true)
    expect(matches('0 16-19 * * *', '2026-10-01T20:00:00')).toBe(false)
    expect(matches('0 16-19 * * *', '2026-10-01T17:01:00')).toBe(false)
    expect(matches('0 */3 * * *', '2026-10-01T09:00:00')).toBe(true)
    expect(matches('0 */3 * * *', '2026-10-01T10:00:00')).toBe(false)
    expect(matches('15,45 * * * *', '2026-10-01T03:45:00')).toBe(true)
    expect(matches('10 3,9 * * *', '2026-10-01T09:10:00')).toBe(true)
  })

  it('matches day-of-week (2026-10-05 is a Monday) and treats 7 as Sunday', () => {
    expect(matches('0 11 * * 1', '2026-10-05T11:00:00')).toBe(true)
    expect(matches('0 11 * * 1', '2026-10-06T11:00:00')).toBe(false)
    expect(matches('0 0 * * 7', '2026-10-04T00:00:00')).toBe(true)
  })

  it('uses standard OR semantics when both day fields are restricted', () => {
    expect(matches('0 0 1 * 1', '2026-10-05T00:00:00')).toBe(true) // a Monday, not the 1st
    expect(matches('0 0 1 * 1', '2026-10-01T00:00:00')).toBe(true) // the 1st, a Thursday
    expect(matches('0 0 1 * 1', '2026-10-06T00:00:00')).toBe(false)
  })

  it('reads the clock in UTC, never local time', () => {
    const d = new Date(Date.UTC(2026, 9, 1, 7, 30))
    expect(compileCron('30 7 * * *')(d)).toBe(true)
  })
})

describe('the Railway scheduler fires exactly what the GitHub workflow fired', () => {
  const crons = readCronSchedule()
  const schedules: string[] = slowTierSchedules(crons)

  it('every slow-tier schedule compiles', () => {
    expect(schedules.length).toBeGreaterThan(0)
    for (const s of schedules) expect(() => compileCron(s), s).not.toThrow()
  })

  it('its schedule set equals the `schedule:` block of cron-slow-tier.yml', () => {
    const yml = fs.readFileSync('.github/workflows/cron-slow-tier.yml', 'utf8')
    const fromYml = [...yml.matchAll(/^\s*- cron: "([^"]+)"/gm)].map((m) => m[1]).sort()
    expect([...schedules].sort()).toEqual(fromYml)
  })

  it('over a full week, each schedule fires and every due minute names only known schedules', () => {
    const compiled = schedules.map((expr) => ({ expr, matches: compileCron(expr) }))
    const fired = new Map<string, number>()
    const start = Date.UTC(2026, 9, 5) // Monday
    for (let t = start; t < start + 7 * 86_400_000; t += 60_000) {
      for (const e of dueSchedules(compiled, new Date(t))) fired.set(e, (fired.get(e) ?? 0) + 1)
    }
    for (const s of schedules) expect(fired.get(s) ?? 0, s).toBeGreaterThan(0)
    expect(fired.get('0 * * * *')).toBe(7 * 24)
    expect(fired.get('15,45 * * * *')).toBe(7 * 48)
    expect(fired.get('0 14 * * 2')).toBe(1)
  })
})

describe('Dockerfile.cron carries everything the scripts read', () => {
  const docker = fs.readFileSync('Dockerfile.cron', 'utf8')
  const copied = [...docker.matchAll(/^COPY (.+) \S+$/gm)].flatMap((m) => m[1].trim().split(/\s+/))

  it('is not named Dockerfile (that would switch the web and worker services off Railpack)', () => {
    expect(fs.existsSync('Dockerfile')).toBe(false)
  })

  it('copies the scheduler, every script it reaches, and the schedule — all of which exist', () => {
    for (const f of copied) expect(fs.existsSync(f), f).toBe(true)
    expect(copied).toContain('cron-schedule.json')
    const seen = new Set<string>()
    const walk = (rel: string) => {
      if (seen.has(rel)) return
      seen.add(rel)
      expect(copied, `${rel} is imported but not copied into the image`).toContain(rel)
      const src = fs.readFileSync(rel, 'utf8')
      for (const m of src.matchAll(/from '([^']+)'/g)) {
        const spec = m[1]
        if (spec.startsWith('node:')) continue
        // No npm install in the image: anything else must be a relative script.
        expect(spec.startsWith('./'), `${rel} imports "${spec}", which the image cannot resolve`).toBe(true)
        walk(path.posix.join(path.posix.dirname(rel), spec))
      }
    }
    walk('scripts/cron-scheduler.mjs')
  })

  it('carries the route file of every fast-tier job, so no timeout falls back silently', () => {
    const dirs = copied.filter((f) => f.startsWith('app/'))
    const { fast } = classifyCrons(withFastTierOperationalOverlays(readCronSchedule()))
    expect(fast.length).toBeGreaterThan(0)
    for (const job of fast as { path: string }[]) {
      const clean = job.path.split('?')[0].replace(/^\/+|\/+$/g, '')
      const route = ['ts', 'tsx', 'js'].map((x) => `app/${clean}/route.${x}`).find((f) => fs.existsSync(f))
      if (!route) continue // no route file at all: the loop already reports "no maxDuration"
      expect(dirs.some((d) => route.startsWith(`${d}/`)), `${route} is outside ${dirs.join(', ')}`).toBe(true)
    }
  })
})
