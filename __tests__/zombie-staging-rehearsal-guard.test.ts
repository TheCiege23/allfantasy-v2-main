import { describe, expect, it } from 'vitest'
import { stagingRehearsalEnabled, rehearsalSourceIds, REHEARSAL_PROJECT } from '@/lib/zombie/stagingRehearsalGuard'
describe('isolated Zombie rehearsal guard', () => {
  const env = { RAILWAY_PROJECT_ID: REHEARSAL_PROJECT, RAILWAY_ENVIRONMENT_NAME: 'staging', ZOMBIE_STAGING_REHEARSAL_ENABLED: '1' }
  it('requires the isolated project, staging environment and an explicit enable flag together', () => {
    expect(stagingRehearsalEnabled(env)).toBe(true)
    expect(stagingRehearsalEnabled({})).toBe(false)
    for (const change of [{ RAILWAY_PROJECT_ID: 'production-project' }, { RAILWAY_ENVIRONMENT_NAME: 'production' }, { ZOMBIE_STAGING_REHEARSAL_ENABLED: '0' }]) expect(stagingRehearsalEnabled({ ...env, ...change })).toBe(false)
  })
  it('refuses an empty, duplicated or malformed source allowlist', () => {
    expect(rehearsalSourceIds({})).toEqual([])
    expect(rehearsalSourceIds({ ZOMBIE_REHEARSAL_SOURCE_LEAGUES: Array(4).fill('fcdc9ae7-60e8-4caa-a3c0-08b6ea9d904a').join(',') })).toEqual([])
    expect(rehearsalSourceIds({ ZOMBIE_REHEARSAL_SOURCE_LEAGUES: 'a,b,c,d' })).toEqual([])
  })
})
