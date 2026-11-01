// @vitest-environment node
/**
 * NFL Fantrax players linked by `fantraxId` get a headshot, and Fantrax draft-board picks get names.
 *
 * 🛑 `connectedRoster` found Fantrax faces only through `rollingInsightsId` / `cfbdId` — the college
 * bridges. NFL identity rows are Sleeper-keyed, so an NFL Fantrax player resolved by id still had no
 * face. The portrait lookup `resolveProviderRosterPlayers` already uses — `SportsPlayer.sleeperId`,
 * never `externalId` — is the bridge.
 *
 * 🛑 Draft HQ's `resolvePlayerNames` read only `PlayerProviderIdentity` for non-Sleeper ids, which
 * nothing fills for Fantrax, so every Fantrax pick read "(not yet mapped)".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ identities: vi.fn(), images: vi.fn(), sleeper: vi.fn(), directory: vi.fn(), providerNames: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {
  playerIdentityMap: { findMany: mocks.identities },
  sportsPlayer: { findMany: mocks.images },
  playerProviderIdentity: { findMany: mocks.providerNames },
} }))
vi.mock('@/lib/player-identity/resolveSleeperRosterPlayers', () => ({ resolveSleeperRosterPlayers: mocks.sleeper }))
vi.mock('@/lib/sport-teams/collegeTeamIndexStore', () => ({ loadCollegeTeamIndex: mocks.directory }))
import { connectedRosterPlayers } from '@/lib/core-app/connectedRoster'
import { resolvePlayerNames } from '@/lib/core-app/draftHq'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.identities.mockResolvedValue([
    { fantraxId: 'fxNfl', canonicalName: 'Josh Allen', position: 'QB', currentTeam: 'BUF', rollingInsightsId: null, cfbdId: null, sleeperId: '4984' },
  ])
  mocks.images.mockResolvedValue([
    { sleeperId: '4984', externalId: 'sleeper:4984', source: 'sleeper', imageUrl: 'https://sleepercdn.com/content/nfl/players/4984.jpg' },
  ])
  mocks.providerNames.mockResolvedValue([])
})

describe('NFL Fantrax roster headshots', () => {
  it('reaches the headshot through the linked row\'s Sleeper id', async () => {
    const [player] = await connectedRosterPlayers('fantrax', 'nfl', [{ fantraxId: 'fxNfl', name: 'Allen, Josh', team: 'BUF' }])
    expect(player.imageUrl).toBe('https://sleepercdn.com/content/nfl/players/4984.jpg')
    const where = mocks.images.mock.calls[0][0].where
    expect(where.sport).toBe('NFL')
    expect(where.OR).toEqual(expect.arrayContaining([{ sleeperId: { in: ['4984'] }, imageUrl: { not: null } }]))
  })
})

describe('Draft HQ names for Fantrax picks', () => {
  it('names a Fantrax pick from PlayerIdentityMap.fantraxId', async () => {
    const out = await resolvePlayerNames(['fxNfl', 'unknown'], 'fantrax')
    expect(out.get('fxNfl')).toMatchObject({ name: 'Josh Allen', position: 'QB', team: 'BUF' })
    expect(out.has('unknown')).toBe(false)
  })
})

describe('Draft HQ faces for Fantrax picks', () => {
  it('gives an NFL Fantrax pick the headshot of its linked Sleeper id', async () => {
    mocks.images.mockResolvedValue([
      { sleeperId: '4984', name: 'Josh Allen', position: 'QB', team: 'BUF', sport: 'NFL', source: 'sleeper',
        imageUrl: 'https://sleepercdn.com/content/nfl/players/4984.jpg', fetchedAt: new Date('2026-10-01') },
    ])
    const out = await resolvePlayerNames(['fxNfl'], 'fantrax', 'NFL')
    expect(out.get('fxNfl')).toMatchObject({ name: 'Josh Allen', imageUrl: 'https://sleepercdn.com/content/nfl/players/4984.jpg' })
    expect(mocks.images.mock.calls[0][0].where).toMatchObject({ sport: 'NFL', sleeperId: { in: ['4984'] } })
  })

  it.each(['MLB', undefined])('keeps a non-NFL (or sport-unknown) Fantrax pick faceless: %s', async (sport) => {
    const out = await resolvePlayerNames(['fxNfl'], 'fantrax', sport)
    expect(out.get('fxNfl')?.imageUrl ?? null).toBeNull()
    expect(mocks.images).not.toHaveBeenCalled()
  })
})
