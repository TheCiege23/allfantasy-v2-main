import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  classifyCrons,
  isFastSchedule,
  readVercelCrons,
  slowTierJobsForSchedule,
  slowTierSchedules,
  SLOW_TIER_EXCLUSIONS,
} from '../scripts/cron-tier.mjs'
import { maxGapMs, NO_PROBE, PROBES } from '../scripts/cron-freshness-check.mjs'

/**
 * Scheduling moved off the host after all 41 crons died on the Vercel -> Railway migration and
 * nothing noticed for six days. These tests pin the two things that would let that recur quietly:
 * a job landing in NEITHER tier, and the workflow's literal schedule list drifting from
 * vercel.json.
 */

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

describe('isFastSchedule', () => {
  it('treats sub-hourly minute fields as fast', () => {
    expect(isFastSchedule('* * * * *')).toBe(true)
    expect(isFastSchedule('*/1 * * * *')).toBe(true)
    expect(isFastSchedule('*/2 * * * *')).toBe(true)
    expect(isFastSchedule('*/30 * * * *')).toBe(true)
  })

  it('keys on the MINUTE field only, so a stepped HOUR stays slow', () => {
    // The trap: `0 */3 * * *` contains a step but fires every three hours. Keying on "contains a
    // step anywhere" would hand it to the host's fast tier for no benefit.
    expect(isFastSchedule('0 */3 * * *')).toBe(false)
    expect(isFastSchedule('0 */6 * * *')).toBe(false)
    expect(isFastSchedule('10 */6 * * *')).toBe(false)
  })

  it('treats fixed-minute schedules as slow', () => {
    expect(isFastSchedule('0 * * * *')).toBe(false)
    expect(isFastSchedule('30 7 * * 2')).toBe(false)
    expect(isFastSchedule('0 16-19 * * *')).toBe(false)
  })
})

describe('classifyCrons', () => {
  it('puts every declared cron in exactly one bucket', () => {
    const crons = readVercelCrons()
    const { fast, slow, excluded } = classifyCrons(crons)
    // The invariant that matters: nothing may fall through. A job in no bucket belongs to no
    // scheduler, which is indistinguishable from "declared and running" until the data goes stale.
    expect(fast.length + slow.length + excluded.length).toBe(crons.length)
    expect(crons.length).toBeGreaterThan(0)
  })

  it('matches exclusions on pathname, not the declared path', () => {
    // Regression: the first version keyed on the full declared path, so
    // `/api/brackets/world-cup/cron/sync?job=all&provider=apifootball&recalculate=true` matched
    // nothing and reported 3 exclusions instead of 4 -- which reads exactly like "nothing to
    // exclude" rather than "the key was wrong".
    const withQuery = [{ path: '/api/guillotine/ai/storyline?force=1', schedule: '0 9 * * 2' }]
    expect(classifyCrons(withQuery).excluded).toHaveLength(1)
    expect(classifyCrons(withQuery).slow).toHaveLength(0)
  })

  it('excludes a fast-scheduled job by cadence before consulting the exclusion list', () => {
    // Order matters: exclusions describe the SLOW tier. A sub-hourly job stays on the host
    // regardless of whether someone also listed it here.
    const fastButListed = [{ path: '/api/guillotine/ai/storyline', schedule: '*/5 * * * *' }]
    expect(classifyCrons(fastButListed).fast).toHaveLength(1)
    expect(classifyCrons(fastButListed).excluded).toHaveLength(0)
  })

  it('carries a reason for every exclusion', () => {
    // An unexplained exclusion is indistinguishable from an oversight.
    for (const [path, entry] of Object.entries(SLOW_TIER_EXCLUSIONS)) {
      expect(entry.reason, `${path} needs a reason`).toBeTruthy()
      expect(entry.reason.length).toBeGreaterThan(30)
    }
  })
})

describe('slowTierJobsForSchedule', () => {
  it('returns every slow job sharing one expression', () => {
    const crons = [
      { path: '/a', schedule: '0 * * * *' },
      { path: '/b', schedule: '0 * * * *' },
      { path: '/c', schedule: '0 9 * * *' },
      { path: '/d', schedule: '*/5 * * * *' },
    ]
    expect(slowTierJobsForSchedule(crons, '0 * * * *').map((c) => c.path)).toEqual(['/a', '/b'])
    expect(slowTierJobsForSchedule(crons, '*/5 * * * *')).toEqual([])
  })

  it('tolerates surrounding whitespace from github.event.schedule', () => {
    const crons = [{ path: '/a', schedule: '0 * * * *' }]
    expect(slowTierJobsForSchedule(crons, '  0 * * * *  ')).toHaveLength(1)
  })
})

describe('maxGapMs', () => {
  it.each([
    ['0 * * * *', HOUR],
    ['*/2 * * * *', 2 * MINUTE],
    ['*/15 * * * *', 15 * MINUTE],
    ['* * * * *', MINUTE],
    ['0 */3 * * *', 3 * HOUR],
    ['0 */6 * * *', 6 * HOUR],
    ['10 */6 * * *', 6 * HOUR],
    ['20 6 * * *', DAY],
    ['0 3 * * 1', 7 * DAY],
    ['30 7 * * 2', 7 * DAY],
  ])('%s -> largest gap %i ms', (expr, want) => {
    expect(maxGapMs(expr)).toBe(want)
  })

  it('measures the LARGEST gap, not the average', () => {
    // `0 16-19 * * *` fires hourly inside a four-hour window, then not again for 21 hours. An
    // average-based threshold (~6h) would page every single night.
    expect(maxGapMs('0 16-19 * * *')).toBe(21 * HOUR)
  })

  it('returns null for an unparseable expression rather than a misleading number', () => {
    expect(maxGapMs('not a cron')).toBeNull()
    expect(maxGapMs('0 0')).toBeNull()
  })
})

describe('age is computed by Postgres, not by the client clock', () => {
  /*
   * A SOURCE-LEVEL GUARD, deliberately, because no behavioural test can catch this.
   *
   * The freshness columns are `timestamp without time zone` holding UTC, and `pg` returns those as
   * JS Dates interpreted in the CLIENT's timezone. `Date.now() - newest` is therefore correct on a
   * UTC runner and wrong everywhere else — a row written 2 minutes ago read as 238 minutes in the
   * FUTURE on a UTC-4 machine. CI runs on UTC, so a test asserting behaviour would pass against
   * the broken code every single time.
   *
   * A negative age is not cosmetic: it makes data look NEWER than it is, so a fast-tier probe with
   * a 20-minute allowance reports healthy no matter how long its job has been dead — a false
   * negative in the tool whose whole purpose is to prevent false negatives.
   */
  const source = readFileSync(join(process.cwd(), 'scripts/cron-freshness-check.mjs'), 'utf8')

  it('pins the session to UTC so the naive-vs-timestamptz distinction stops mattering', () => {
    expect(source).toContain("SET TIME ZONE 'UTC'")
  })

  it('derives every age from EXTRACT(EPOCH FROM (now() - max(...)))', () => {
    const extracts = source.match(/EXTRACT\(EPOCH FROM \(now\(\) - max\(/g) ?? []
    // One for the output probes, one for the heartbeat probes.
    expect(extracts.length).toBeGreaterThanOrEqual(2)
  })

  it('never subtracts a fetched timestamp from Date.now()', () => {
    // The exact regression: `Date.now() - newest.getTime()`.
    expect(source).not.toMatch(/Date\.now\(\)\s*-\s*\w+\.getTime\(\)/)
  })
})

describe('freshness coverage is total', () => {
  const crons = readVercelCrons()

  it('classifies every declared cron as probed, deliberately unprobed, or excluded', () => {
    // The invariant that keeps the coverage list honest. A cron that is none of these is a silent
    // gap -- exactly what let the 41-cron outage run for six days -- so adding one to vercel.json
    // fails here until someone decides which it is.
    const unclassified = crons
      .filter((c) => !PROBES[c.path])
      .filter((c) => !NO_PROBE[c.path])
      .filter((c) => !SLOW_TIER_EXCLUSIONS[c.path.split('?')[0]])
      .map((c) => `${c.schedule}  ${c.path}`)

    expect(unclassified, `unclassified crons:\n  ${unclassified.join('\n  ')}`).toEqual([])
  })

  it('gives every deliberately-unprobed cron a substantive reason', () => {
    for (const [path, reason] of Object.entries(NO_PROBE)) {
      expect(reason, `${path} needs a reason`).toBeTruthy()
      expect(reason.length, `${path}: "${reason}" is too terse to act on`).toBeGreaterThan(40)
    }
  })

  it('never points a probe at both a table and a heartbeat', () => {
    // The two read completely different queries; carrying both would silently pick one.
    for (const [path, probe] of Object.entries(PROBES)) {
      const hasTable = Boolean(probe.table)
      const hasHeartbeat = Boolean(probe.heartbeat)
      expect(hasTable !== hasHeartbeat, `${path} must have exactly one of table/heartbeat`).toBe(true)
    }
  })

  it('does not both probe and excuse the same cron', () => {
    const both = Object.keys(PROBES).filter((p) => NO_PROBE[p])
    expect(both).toEqual([])
  })

  it('only names crons that are actually declared', () => {
    // A probe for a path removed from vercel.json is dead config that reads as coverage.
    const declared = new Set(crons.map((c) => c.path))
    const orphans = [...Object.keys(PROBES), ...Object.keys(NO_PROBE)].filter((p) => !declared.has(p))
    expect(orphans, `probe entries with no matching cron:\n  ${orphans.join('\n  ')}`).toEqual([])
  })
})

describe('cron-slow-tier.yml stays in sync with vercel.json', () => {
  // The workflow's `schedule:` block is literal YAML and cannot be generated at run time, so it is
  // the one place the two schedulers can silently drift apart. scripts/cron-budget-check.mjs
  // enforces this on every PR; this test is the same assertion where a developer sees it first.
  const yaml = readFileSync(join(process.cwd(), '.github/workflows/cron-slow-tier.yml'), 'utf8')
  const declared = [...yaml.matchAll(/^\s*-\s*cron:\s*["']([^"']+)["']/gm)].map((m) => m[1].trim())

  it('declares every slow-tier schedule', () => {
    const required = slowTierSchedules(readVercelCrons())
    expect([...declared].sort()).toEqual([...required].sort())
  })

  it('declares no schedule twice', () => {
    expect(new Set(declared).size).toBe(declared.length)
  })
})
