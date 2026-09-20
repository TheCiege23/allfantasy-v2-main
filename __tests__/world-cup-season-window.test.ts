import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  WORLD_CUP_SEASON_YEAR,
  isWorldCupCreationOpen,
  worldCupEntriesCloseAt,
} from '@/lib/world-cup/worldCupSeasonWindow'

const ENV_KEY = 'NEXT_PUBLIC_WORLD_CUP_ENTRIES_CLOSE_AT'

describe('world cup season window', () => {
  const original = process.env[ENV_KEY]

  beforeEach(() => {
    delete process.env[ENV_KEY]
  })

  afterEach(() => {
    if (original === undefined) delete process.env[ENV_KEY]
    else process.env[ENV_KEY] = original
  })

  it('defaults to the cron cutoff, so "crons stopped" and "entry closed" are the same moment', () => {
    expect(worldCupEntriesCloseAt()?.toISOString()).toBe('2026-07-20T06:00:00.000Z')
    expect(WORLD_CUP_SEASON_YEAR).toBe(2026)
  })

  it('is open before the cutoff and closed after', () => {
    expect(isWorldCupCreationOpen(new Date('2026-06-01T00:00:00Z'))).toBe(true)
    expect(isWorldCupCreationOpen(new Date('2026-07-20T05:59:59Z'))).toBe(true)
    expect(isWorldCupCreationOpen(new Date('2026-07-20T06:00:00Z'))).toBe(false)
    expect(isWorldCupCreationOpen(new Date('2026-09-20T00:00:00Z'))).toBe(false)
  })

  it('an explicit empty override disables the gate', () => {
    process.env[ENV_KEY] = ''
    expect(worldCupEntriesCloseAt()).toBeNull()
    expect(isWorldCupCreationOpen(new Date('2030-01-01T00:00:00Z'))).toBe(true)
  })

  it('an override reopens a season without a code change', () => {
    process.env[ENV_KEY] = '2030-07-01T00:00:00Z'
    expect(isWorldCupCreationOpen(new Date('2029-01-01T00:00:00Z'))).toBe(true)
    expect(isWorldCupCreationOpen(new Date('2031-01-01T00:00:00Z'))).toBe(false)
  })

  it('FAILS OPEN on an unparseable override, rather than locking out a live tournament', () => {
    process.env[ENV_KEY] = 'not-a-date'
    expect(worldCupEntriesCloseAt()).toBeNull()
    expect(isWorldCupCreationOpen(new Date('2026-09-20T00:00:00Z'))).toBe(true)
  })

  it('today is past the cutoff — the gate is live, not theoretical', () => {
    // The whole reason this module exists. If this ever reads true with no override set, the
    // default has been moved and the create flow is open again.
    delete process.env[ENV_KEY]
    expect(isWorldCupCreationOpen()).toBe(false)
  })
})
