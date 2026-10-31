import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findMany } } }))
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>
      {children}
    </a>
  ),
}))

import { leagueAudience } from '@/lib/league-privacy/leagueAudience'
import { attachLeagueAudience } from '@/lib/core-app/attachLeagueAudience'
import { isFantasyLeagueDiscoverable } from '@/lib/public-discovery/DiscoveryQueryLayer'
import { MyLeaguesV4 } from '@/components/core-app/screens/MyLeaguesV4'
import type { MyLeaguesLeague } from '@/lib/core-app/myLeagues'

describe('leagueAudience — every league is public or private', () => {
  it('is public only when the commissioner chose it', () => {
    expect(leagueAudience({ league_privacy_visibility: 'public' })).toBe('public')
    expect(leagueAudience({ league_privacy_visibility: ' Public ' })).toBe('public')
    expect(leagueAudience({ publicDashboard: true })).toBe('public')
  })

  it('reads everything else as private — including leagues that never had the key written', () => {
    expect(leagueAudience({ league_privacy_visibility: 'private' })).toBe('private')
    expect(leagueAudience({ league_privacy_visibility: 'invite_only' })).toBe('private')
    expect(leagueAudience({})).toBe('private')
    expect(leagueAudience(null)).toBe('private')
    expect(leagueAudience([])).toBe('private')
    expect(leagueAudience({ publicDashboard: 'true' })).toBe('private')
  })

  it('agrees with Find a League: a private league is never listed', () => {
    const code = { inviteCode: 'abc' }
    expect(isFantasyLeagueDiscoverable({ ...code, league_privacy_visibility: 'public' })).toBe(true)
    expect(isFantasyLeagueDiscoverable({ ...code })).toBe(false)
    expect(isFantasyLeagueDiscoverable({ ...code, league_privacy_visibility: 'private' })).toBe(false)
  })
})

describe('attachLeagueAudience', () => {
  beforeEach(() => {
    findMany.mockReset()
  })

  it('labels leagues made here and leaves other platforms unlabelled', async () => {
    findMany.mockResolvedValue([
      { id: 'pub', settings: { league_privacy_visibility: 'public' } },
      { id: 'old', settings: {} },
    ])
    const leagues: Array<{ id: string; platform: string; audience?: 'public' | 'private' | null }> = [
      { id: 'pub', platform: 'manual' },
      { id: 'old', platform: 'manual' },
      { id: 'slp', platform: 'sleeper' },
    ]
    await attachLeagueAudience(leagues)
    expect(leagues.map((l) => l.audience)).toEqual(['public', 'private', null])
    // Only the native ids are read.
    expect(findMany.mock.calls[0][0].where.id.in).toEqual(['pub', 'old'])
  })

  it('labels nothing when the read fails, rather than guessing private', async () => {
    findMany.mockRejectedValue(new Error('db down'))
    const leagues: Array<{ id: string; platform: string; audience?: 'public' | 'private' | null }> = [
      { id: 'pub', platform: 'manual' },
    ]
    await attachLeagueAudience(leagues)
    expect(leagues[0].audience).toBeNull()
  })

  it('makes no read when there is no league made here', async () => {
    const leagues = [{ id: 'slp', platform: 'sleeper' }]
    await attachLeagueAudience(leagues)
    expect(findMany).not.toHaveBeenCalled()
  })
})

describe('My Leagues card', () => {
  function league(id: string, over: Partial<MyLeaguesLeague>): MyLeaguesLeague {
    return {
      id,
      name: `League ${id}`,
      platform: 'manual',
      sport: 'NFL',
      tier: 'quiet',
      isDynasty: false,
      isCommissioner: true,
      reason: null,
      href: `/league/${id}`,
      ...over,
    } as MyLeaguesLeague
  }

  it('says PUBLIC or PRIVATE on each league made here, and nothing on an imported one', () => {
    const leagues = [
      league('a', { audience: 'public' }),
      league('b', { audience: 'private' }),
      league('c', { platform: 'sleeper', audience: null, isCommissioner: false }),
    ]
    render(
      <MyLeaguesV4
        leagues={leagues}
        history={[]}
        counts={{ live: 3, history: 0, all: 3, needs: 0, playing: 0, quiet: 3, commissioner: 2, drafting: 0, dynasty: 0 }}
        platforms={['manual', 'sleeper']}
        coverage={[]}
        notice={null}
        importHref="/import"
      />,
    )
    const labels = screen.getAllByTestId('ml-league-audience')
    expect(labels.map((el) => [el.textContent, el.getAttribute('data-audience')])).toEqual([
      ['PUBLIC', 'public'],
      ['PRIVATE', 'private'],
    ])
  })
})
