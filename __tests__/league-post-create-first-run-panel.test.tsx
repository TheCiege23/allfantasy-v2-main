import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LeaguePostCreateFirstRunPanel } from '@/components/league/post-create-first-run/LeaguePostCreateFirstRunPanel'

const nav = vi.hoisted(() => ({
  replace: vi.fn(),
  params: new URLSearchParams('created=1&guide=settings'),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace }),
  usePathname: () => '/league/abc',
  useSearchParams: () => nav.params,
}))

const panelProps = {
  leagueId: 'league-1',
  leagueName: 'Test League',
  sport: 'NFL',
  leagueType: 'redraft',
  leagueVariant: null as string | null,
  isDynasty: false,
  bestBallMode: false,
  guillotineMode: false,
  settings: {},
  isCommissioner: true,
  isOwner: true,
  userTeamId: 'team-1' as string | null,
  inviteToken: 'tok',
  draftDateIso: new Date('2030-01-15T20:00:00Z').toISOString(),
  embedMode: false,
  firstRunNiceEvidence: { welcomeMessagePostedEvidence: false } as const,
  onOpenInviteSettings: () => {},
  onOpenDraftTab: () => {},
  onOpenDraftSettings: () => {},
  onOpenLeagueChat: () => {},
  onOpenLeagueSettings: () => {},
}

describe('LeaguePostCreateFirstRunPanel', () => {
  beforeEach(() => {
    nav.replace.mockClear()
    nav.params = new URLSearchParams('created=1&guide=settings')
  })

  it('renders hero when commissioner and created=1', () => {
    render(<LeaguePostCreateFirstRunPanel {...panelProps} />)
    expect(screen.getByText(/League created/i)).toBeTruthy()
    expect(screen.getByText('Test League')).toBeTruthy()
  })

  it('surfaces welcome NICE checklist when server evidence is present', () => {
    render(<LeaguePostCreateFirstRunPanel {...panelProps} />)
    expect(screen.getByText(/Welcome message posted/i)).toBeTruthy()
  })

  it('omits welcome NICE row when evidence is null (server skipped)', () => {
    render(<LeaguePostCreateFirstRunPanel {...panelProps} firstRunNiceEvidence={null} />)
    expect(screen.queryByText(/Welcome message posted/i)).toBeNull()
  })

  it('does not render when created flag missing', () => {
    nav.params = new URLSearchParams('guide=settings')
    render(<LeaguePostCreateFirstRunPanel {...panelProps} firstRunNiceEvidence={null} />)
    expect(screen.queryByText(/League created/i)).toBeNull()
  })

  it('does not render in embed mode', () => {
    nav.params = new URLSearchParams('created=1')
    render(<LeaguePostCreateFirstRunPanel {...panelProps} embedMode firstRunNiceEvidence={null} />)
    expect(screen.queryByText(/League created/i)).toBeNull()
  })
})
