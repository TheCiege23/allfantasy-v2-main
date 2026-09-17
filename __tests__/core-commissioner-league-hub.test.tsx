import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

/*
 * Commissioner Hub, one league — /core/commissioner?league= (five-doors restyle,
 * 2026-09-17). Every section stays; the header, key-art band and footer take the
 * format hubs' dress. Pinned: the tiles now live in the band (and an unmeasured one
 * still says why), the way back to all leagues, the league's own art, a send button
 * only where a send is accepted, and Commissioner OS offered only to the owner it
 * admits — opening on THIS league.
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/lib/core-app/commissioner/reports', () => ({
  loadAuditTimeline: () => Promise.resolve({ available: true, data: [] }),
  loadActivityCharts: () => Promise.resolve({ available: false, reason: 'n/a' }),
}))
// The streamed sections are async server components; their own suites cover them.
vi.mock('@/components/core-app/commissioner/HubReports', () => ({
  OperationalCharts: () => null,
  ChartsFallback: () => null,
  RecentChanges: () => null,
  RecentChangesFallback: () => null,
  AuditTimeline: () => null,
  AuditTimelineFallback: () => null,
}))
vi.mock('@/components/commish/BroadcastModal', () => ({ default: () => null }))
vi.mock('@/components/core-app/commissioner/GuidedWorkflows', () => ({ GuidedWorkflows: () => null }))
vi.mock('@/components/core-app/commissioner/AutomationRecipes', () => ({ AutomationRecipes: () => null }))
vi.mock('@/components/core-app/PublishStandingsToggle', () => ({ PublishStandingsToggle: () => null }))

import { CommissionerHub } from '@/components/core-app/screens/CommissionerHub'
import type { CommissionerHubData } from '@/lib/core-app/commissionerHub'
import { ACTIVE_LEAGUE_COOKIE_KEY } from '@/lib/commissioner-ui/activeLeague/constants'

function hub(over: Partial<CommissionerHubData> = {}): CommissionerHubData {
  return {
    allowed: true,
    grant: {} as CommissionerHubData['grant'],
    league: { id: 'L1', name: 'Dynasty Dragons', platform: 'sleeper', season: 2026, native: false },
    role: 'commissioner',
    viewerIsOwner: true,
    viewerCanBroadcast: false,
    tiles: [
      { key: 'health', label: 'League health', tone: 'good', state: { available: true, data: { value: '82', sub: 'Healthy · 90% confidence' } } },
      { key: 'needs-you', label: 'Needs you', tone: 'warn', state: { available: true, data: { value: '2', sub: 'task cards above' } } },
      { key: 'managers', label: 'Active managers', tone: 'neutral', state: { available: false, reason: 'last sync was 9 days ago' } },
    ],
    tasks: { cards: [], overflow: [] },
    tasksEmptyReason: 'Nothing in this league needs you right now.',
    health: { score: { available: false, reason: 'not enough data' }, flags: [] },
    members: {
      available: true,
      data: {
        rows: [
          { name: 'quiet-owl', status: 'inactive', detail: 'no moves in 14 days' },
          { name: 'lark', status: 'active', detail: '3 moves' },
        ],
        total: 2,
        active: 1,
        inactive: 1,
        basis: 'moves',
      },
    },
    calendar: { events: [], gaps: [], ics: null } as unknown as CommissionerHubData['calendar'],
    areas: [],
    workflows: [],
    communities: [],
    recipes: { values: {}, saved: false, updatedAt: null, sendEnabled: false, catalog: [] } as unknown as CommissionerHubData['recipes'],
    charts: { scoring: null, balance: null, engagement: null },
    settings: [],
    access: [],
    unread: false,
    disputes: { available: false, reason: 'not scanned' },
    publicStandings: { enabled: false, url: '/standings/L1' },
    waivers: { available: false, reason: 'no waivers' } as unknown as CommissionerHubData['waivers'],
    art: { label: 'Dynasty', video: '/league-type-dynasty.mp4', poster: '/league-type-dynasty.png' },
    chatHref: '/league/L1?view=league_chat',
    unclaimedTeams: 3,
    quietManagers: ['quiet-owl'],
    ...over,
  }
}

describe('<CommissionerHub /> in the hub dress', () => {
  it('leads with the way back to every league you run and the league as the title', () => {
    render(<CommissionerHub data={hub()} />)
    expect(screen.getByRole('link', { name: '← All leagues you run' }).getAttribute('href')).toBe('/core/commissioner')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Dynasty Dragons')
    expect(screen.getByText('Core · Commissioner · Dynasty')).toBeTruthy()
  })

  it('carries the tiles in the key-art band, with an unmeasured one still saying why', () => {
    const { container } = render(<CommissionerHub data={hub()} />)
    const band = screen.getByRole('region', { name: 'Dynasty Dragons right now' })
    expect(band.querySelectorAll('.afh-tile')).toHaveLength(3)
    expect(band.textContent).toContain('last sync was 9 days ago')
    expect(container.querySelector('.af-ch-tiles')).toBeNull()
    const video = band.querySelector('video')
    expect(video?.getAttribute('src')).toBe('/league-type-dynasty.mp4')
    expect(video?.getAttribute('poster')).toBe('/league-type-dynasty.png')
  })

  it('names who has gone quiet and prompts invites for unconnected teams', () => {
    render(<CommissionerHub data={hub()} />)
    expect(screen.getByText(/Gone quiet: quiet-owl\./)).toBeTruthy()
    expect(screen.getByText(/3 teams aren’t connected/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Invite managers' }).getAttribute('href')).toBe('#ch-areas')
  })

  it('says nothing about quiet managers when there are none to name', () => {
    render(<CommissionerHub data={hub({ quietManagers: [], unclaimedTeams: 0 })} />)
    expect(screen.queryByText(/Gone quiet/)).toBeNull()
    expect(screen.queryByText(/connected to an/)).toBeNull()
  })

  it('shows the still, and no seal, for a league with no looping art', () => {
    render(<CommissionerHub data={hub({ art: { label: 'Redraft', video: null, poster: '/af-robot-king.png' } })} />)
    const band = screen.getByRole('region', { name: 'Dynasty Dragons right now' })
    expect(band.getAttribute('data-art')).toBe('still')
    expect(band.querySelector('video')).toBeNull()
    expect(band.querySelector('img')?.getAttribute('src')).toBe('/af-robot-king.png')
    expect(band.querySelector('.afh-seal')).toBeNull()
  })

  it('offers Send @everyone in the title row only where a send is accepted', () => {
    const { unmount } = render(<CommissionerHub data={hub()} />)
    expect(screen.queryByRole('button', { name: 'Send @everyone' })).toBeNull()
    unmount()
    render(<CommissionerHub data={hub({ viewerCanBroadcast: true })} />)
    expect(screen.getByRole('button', { name: 'Send @everyone' })).toBeTruthy()
  })

  it('opens Commissioner OS on this league for the owner, and not at all for a co-commissioner', () => {
    const { unmount } = render(<CommissionerHub data={hub()} />)
    const os = screen.getByRole('link', { name: 'Health trends in Commissioner OS →' })
    expect(os.getAttribute('href')).toBe('/commissioner-os/league-health')
    os.addEventListener('click', (e) => e.preventDefault())
    os.click()
    expect(document.cookie).toContain(`${ACTIVE_LEAGUE_COOKIE_KEY}=L1`)
    expect(screen.getByRole('link', { name: 'Open league chat →' }).getAttribute('href')).toBe('/league/L1?view=league_chat')
    unmount()

    render(<CommissionerHub data={hub({ viewerIsOwner: false, role: 'co_commissioner' })} />)
    expect(screen.queryByRole('link', { name: /Commissioner OS/ })).toBeNull()
    expect(screen.getByRole('link', { name: 'Open league chat →' })).toBeTruthy()
  })

  it('keeps the blocked state for someone who does not run the league, with the way back', () => {
    render(
      <CommissionerHub
        data={{ allowed: false, role: 'member', leagueName: 'Dynasty Dragons', reason: 'Commissioners and co-commissioners only.' }}
      />,
    )
    expect(screen.getByText('Commissioners and co-commissioners only')).toBeTruthy()
    expect(screen.getByRole('link', { name: '← All leagues you run' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: /right now/ })).toBeNull()
  })
})
