// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ ready: true, rows: [] as unknown[] }))
vi.mock('@/lib/class-rating/store', () => ({
  CLASS_SPORT: 'NFL',
  classTablesReady: vi.fn(async () => db.ready),
}))
vi.mock('@/lib/prisma', () => ({ prisma: { $queryRaw: vi.fn(async () => db.rows) } }))

import { getManagerClass, toManagerClass } from '@/lib/class-rating/reads'

const base = {
  subjectKey: 'sleeper:1',
  rating: 1580,
  rd: 70,
  games: 40,
  computedAt: new Date('2026-10-01T10:00:00Z'),
}

describe('toManagerClass — uncertainty travels with the number', () => {
  it('no row is UNRATED, never Class 1', () => {
    expect(toManagerClass(null)).toEqual({ status: 'unrated' })
  })

  it('a provisional rating carries no Class and no division', () => {
    const c = toManagerClass({ ...base, rd: 180, established: false, percentile: null, classLevel: null, division: null })
    expect(c.status).toBe('provisional')
    expect(c).not.toHaveProperty('classLevel')
    expect(c).not.toHaveProperty('division')
  })

  it('an established rating carries Class, division and percentile', () => {
    const c = toManagerClass({ ...base, established: true, percentile: 0.82, classLevel: 21, division: 5 })
    expect(c).toMatchObject({ status: 'established', classLevel: 21, division: 5, percentile: 0.82, rd: 70 })
  })

  it('an "established" row missing its Class is shown as provisional, not invented', () => {
    const c = toManagerClass({ ...base, established: true, percentile: null, classLevel: null, division: null })
    expect(c.status).toBe('provisional')
  })
})

describe('getManagerClass', () => {
  it('reads unrated with no user, no table, or no row', async () => {
    expect(await getManagerClass(null)).toEqual({ status: 'unrated' })
    db.ready = false
    expect(await getManagerClass('u1')).toEqual({ status: 'unrated' })
    db.ready = true
    db.rows = []
    expect(await getManagerClass('u1')).toEqual({ status: 'unrated' })
  })
})
