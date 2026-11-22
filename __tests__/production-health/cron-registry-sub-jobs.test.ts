import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SUB_JOBS, buildCronRegistry } from '@/lib/production-health/cronRegistry'

const WAIVER = { path: '/api/redraft/waiver-process', schedule: '5 * * * *' }
const OTHER = { path: '/api/cron/waivers', schedule: '0 * * * *' }
const exists = () => true

describe('jobs that run inside a cron route', () => {
  it('get a row each, under their parent, with a key of their own', () => {
    const reg = buildCronRegistry([OTHER, WAIVER], exists)
    const subs = reg.entries.filter((e) => e.subJobOf)
    expect(subs.map((e) => e.jobName)).toEqual(['cron-lineup-lock-snapshots', 'cron-sleeper-lineup-snapshots', 'cron-espn-lineup-snapshots'])
    for (const e of subs) {
      expect(e).toMatchObject({ subJobOf: WAIVER.path, pathname: WAIVER.path, schedule: WAIVER.schedule, instrumented: true, routeExists: true, duplicateOf: null })
      expect(e.label).toMatch(/^Lineup Integrity snapshots: /)
    }
    // Row keys stay unique, so the page never renders two rows under one key.
    const paths = reg.entries.map((e) => e.path)
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('do not count as declared crons, so coverage still means coverage', () => {
    const reg = buildCronRegistry([OTHER, WAIVER], exists)
    expect(reg.totalDeclared).toBe(2)
    expect(reg.subJobCount).toBe(3)
    expect(reg.entries).toHaveLength(5)
  })

  it('a sub-job whose parent is not declared is not listed; a duplicated parent lists it once', () => {
    expect(buildCronRegistry([OTHER], exists).entries.some((e) => e.subJobOf)).toBe(false)
    const dup = buildCronRegistry([WAIVER, WAIVER], exists)
    expect(dup.entries.filter((e) => e.subJobOf)).toHaveLength(3)
  })

  it('the waiver cron row names the job its route actually writes', () => {
    const row = buildCronRegistry([WAIVER], exists).entries.find((e) => e.path === WAIVER.path)!
    expect(row).toMatchObject({ jobName: 'cron-redraft-waiver-process', instrumented: true })
    const route = readFileSync('app/api/redraft/waiver-process/route.ts', 'utf8')
    expect(route).toMatch(/^const JOB = 'cron-redraft-waiver-process'/m)
  })

  it('every listed sub-job is a job name its parent route really writes', () => {
    for (const sub of SUB_JOBS) {
      const route = readFileSync(`app${sub.parentPathname}/route.ts`, 'utf8')
      expect(route).toContain(`jobName: '${sub.jobName}'`)
    }
  })
})
