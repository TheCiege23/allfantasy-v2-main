import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import PlayoffBracketEntryShell from '@/components/brackets/playoffs/PlayoffBracketEntryShell'
import type { PlayoffChallengeView } from '@/lib/playoffs/types'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: null }) }))
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a> }))
vi.mock('@/components/brackets/playoffs/useNbaCupLiveView', () => ({ useNbaCupLiveView: vi.fn() }))
vi.mock('@/components/brackets/playoffs/MlbBracketBoard', () => ({ default: ({ actions }: any) => <div>{actions}</div> }))
vi.mock('@/components/brackets/playoffs/PlayoffBracketBoard', () => ({ default: () => null }))
vi.mock('@/components/brackets/playoffs/BracketCoachPanel', () => ({ default: () => null }))
vi.mock('@/components/chimmy/BracketChangeAlertToggle', () => ({ BracketChangeAlertToggle: ({ entryId }: any) => <button role="switch" aria-label={`Alerts for ${entryId}`} /> }))

afterEach(cleanup)

function view(sport: string, owner: boolean): PlayoffChallengeView {
  return {
    viewerUserId: owner ? 'owner' : 'viewer',
    challenge: { id: 'pool', name: 'QA pool', ownerUserId: 'owner', sport, seasonYear: 2026,
      isTestMode: true, status: 'open', lockRule: 'series_start' },
    activeEntry: { id: 'entry', name: 'My saved picks', userId: 'owner', pickCount: 0, isComplete: false },
    entries: [], series: [], picks: [], rounds: [],
  } as unknown as PlayoffChallengeView
}

it('hides invite actions when a private CFP participant does not receive an invite code', () => {
  const participant = view('ncaaf', true)
  participant.challenge.inviteCode = ''
  render(<PlayoffBracketEntryShell initialView={participant} />)
  expect(screen.queryByRole('button', { name: 'Invite friends' })).toBeNull()
})

it.each(['mlb', 'ncaaf', 'nba_cup', 'nfl', 'nba', 'nhl'])('shows contextual Chimmy controls to the %s entry owner', (sport) => {
  render(<PlayoffBracketEntryShell initialView={view(sport, true)} />)
  const link = screen.getByRole('link', { name: 'Ask Chimmy about my picks' })
  expect(link.getAttribute('href')).toContain('playoff_bracket_entry')
  expect(new URL(link.getAttribute('href')!, 'https://qa.invalid').searchParams.get('sport')).toBe(sport === 'nba_cup' ? 'NBA' : sport.toUpperCase())
  expect(decodeURIComponent(link.getAttribute('href') ?? '').replaceAll('+', ' ')).toContain('My saved picks')
  expect(screen.getByRole('switch', { name: 'Alerts for entry' })).toBeTruthy()
})

it.each(['mlb', 'ncaaf', 'nba_cup', 'nfl', 'nba', 'nhl'])('hides personal Chimmy controls from a different %s entry viewer', (sport) => {
  render(<PlayoffBracketEntryShell initialView={view(sport, false)} />)
  expect(screen.queryByRole('link', { name: 'Ask Chimmy about my picks' })).toBeNull()
  expect(screen.queryByRole('switch', { name: 'Alerts for entry' })).toBeNull()
})
