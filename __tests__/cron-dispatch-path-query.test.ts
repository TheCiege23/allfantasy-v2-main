import { describe, expect, it } from 'vitest'

// @ts-expect-error -- .mjs script, no types. Importable only because of its `invokedDirectly` guard.
import { selectJobs } from '../scripts/cron-dispatch.mjs'

const crons = [
  { path: '/api/cron/compute-projections', schedule: '0 7 * * *' },
  { path: '/api/cron/import-injuries', schedule: '0 */6 * * *' },
]

describe('cron-dispatch --path', () => {
  it('sends the query string on a registered job instead of dropping it', () => {
    const jobs = selectJobs(crons, { path: '/api/cron/compute-projections?sport=MLB' })
    expect(jobs.map((j: { path: string }) => j.path)).toEqual(['/api/cron/compute-projections?sport=MLB'])
  })

  it('keeps the registered path when no query is given', () => {
    const jobs = selectJobs(crons, { path: '/api/cron/compute-projections' })
    expect(jobs.map((j: { path: string }) => j.path)).toEqual(['/api/cron/compute-projections'])
  })

  it('still refuses a path the registry does not list, query or not', () => {
    expect(selectJobs(crons, { path: '/api/cron/not-registered?sport=MLB' })).toEqual([])
  })
})
