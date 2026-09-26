import { describe, expect, it } from 'vitest'
import { selectRiProfileSports, RI_PROFILES_SPLIT_BEFORE_UTC_HOUR } from '@/lib/cron/riProfileSports'

/**
 * 🛑 NCAAF (69,043 players) is more than the other six sports together, and whenever the rotation
 * reached it every sport behind it was deferred — MLB went a week between refreshes while every run
 * read `success`. The single cron entry now fires at 03:10 and 09:10 UTC and the hour picks the half.
 */
const ALL = ['NFL', 'NCAAF', 'MLB', 'NBA', 'NHL', 'NCAAB', 'SOCCER'] as const
const at = (iso: string) => new Date(iso)

describe('selectRiProfileSports', () => {
  it('the early fire sweeps NCAAF alone, with the whole budget', () => {
    expect(selectRiProfileSports({ allSports: ALL, now: at('2026-09-27T03:10:00Z') })).toEqual(['NCAAF'])
  })

  it('a LATE early fire is still the NCAAF half (GitHub can start a schedule late)', () => {
    expect(selectRiProfileSports({ allSports: ALL, now: at('2026-09-27T08:59:00Z') })).toEqual(['NCAAF'])
  })

  it('the 09:10 fire sweeps the other six and never NCAAF', () => {
    const out = selectRiProfileSports({ allSports: ALL, now: at('2026-09-27T09:10:00Z') })
    expect(out).toHaveLength(6)
    expect(out).not.toContain('NCAAF')
    expect([...out].sort()).toEqual(['MLB', 'NBA', 'NCAAB', 'NFL', 'NHL', 'SOCCER'])
  })

  it('a delayed 09:10 fire is still the six-sport half', () => {
    expect(selectRiProfileSports({ allSports: ALL, now: at('2026-09-27T11:45:00Z') })).not.toContain('NCAAF')
  })

  it('rotates the six so each leads in turn over six days', () => {
    const leads = new Set<string>()
    for (let d = 20; d < 26; d += 1) {
      leads.add(selectRiProfileSports({ allSports: ALL, now: at(`2026-09-${d}T09:10:00Z`) })[0]!)
    }
    expect([...leads].sort()).toEqual(['MLB', 'NBA', 'NCAAB', 'NFL', 'NHL', 'SOCCER'])
  })

  it('an explicit ?sport= always wins, at any hour', () => {
    expect(selectRiProfileSports({ allSports: ALL, explicitSport: 'soccer', now: at('2026-09-27T03:10:00Z') })).toEqual(['SOCCER'])
    expect(selectRiProfileSports({ allSports: ALL, explicitSport: 'NCAAF', now: at('2026-09-27T09:10:00Z') })).toEqual(['NCAAF'])
  })

  it('ignores an unknown ?sport= rather than sweeping nothing', () => {
    expect(selectRiProfileSports({ allSports: ALL, explicitSport: 'CURLING', now: at('2026-09-27T09:10:00Z') })).toHaveLength(6)
  })

  it('the split hour sits between the two scheduled fire hours in cron-schedule.json', async () => {
    const { readFileSync } = await import('node:fs')
    const cron = JSON.parse(readFileSync('cron-schedule.json', 'utf8')) as { crons: Array<{ path: string; schedule: string }> }
    const entry = cron.crons.find((c) => c.path === '/api/cron/import-schedules?riProfiles=1')
    expect(entry?.schedule).toBe('10 3,9 * * *')
    const hours = entry!.schedule.split(' ')[1]!.split(',').map(Number)
    expect(hours.filter((h) => h < RI_PROFILES_SPLIT_BEFORE_UTC_HOUR)).toEqual([3])
    expect(hours.filter((h) => h >= RI_PROFILES_SPLIT_BEFORE_UTC_HOUR)).toEqual([9])
  })
})
