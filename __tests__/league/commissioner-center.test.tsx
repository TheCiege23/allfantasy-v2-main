/**
 * Commissioner center (handoff Commissioner.png): the desktop League Settings layout for a
 * commissioner. It must reuse the builder's rows and the caller's editors — never offer a section
 * the builder did not hand an editor for — and the Survivor tribe setup entry appears only for
 * Survivor leagues.
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { buildLeagueSettingsHome, type BuildSettingsHomeInput } from '@/lib/league-settings-home/buildLeagueSettingsHome'
import { CommissionerCenter } from '@/components/league-settings/home/CommissionerCenter'

const teams = Array.from({ length: 12 }, (_, i) => ({ claimedByUserId: i < 3 ? `u${i}` : null, isCoCommissioner: false, ownerName: `Owner ${i}` }))

function input(league: Partial<BuildSettingsHomeInput['league']> = {}, canEdit = true): BuildSettingsHomeInput {
  return {
    league: { id: 'lg1', name: 'Blah', sport: 'NFL', leagueSize: 12, leagueVariant: null, settings: {}, ...league },
    teams,
    canEdit,
    formatLabel: 'Redraft',
    scoringLabel: 'Half PPR',
    rosterSlots: { QB: 1, RB: 2 },
    draft: { dateIso: null, type: 'snake', rounds: 15, timerSeconds: 90, autostart: false },
    guillotine: null,
    inviteUrl: 'https://allfantasy.ai/join?code=ABC',
  }
}

function renderCenter(i: BuildSettingsHomeInput, inSeason = false) {
  const renderSubPage = vi.fn((id: string) => ({ title: `Edit ${id}`, content: <p>editor for {id}</p> }))
  render(
    <CommissionerCenter
      leagueName="Blah"
      sections={buildLeagueSettingsHome(i)}
      renderSubPage={renderSubPage as never}
      inSeason={inSeason}
      managers={{ joined: 3, total: 12, inviteUrl: 'https://allfantasy.ai/join?code=ABC' }}
    />,
  )
  return { renderSubPage }
}

describe('CommissionerCenter', () => {
  it('opens on League settings and shows that section’s existing editor', () => {
    renderCenter(input())
    expect(screen.getByTestId('cc-pane').getAttribute('data-subpage')).toBe('general')
    expect(screen.getByText('editor for general')).toBeTruthy()
    expect(screen.getByTestId('cc-nav-general').getAttribute('aria-current')).toBe('page')
  })

  it('switches the pane from the nav and from a commissioner tool', () => {
    renderCenter(input(), true)
    fireEvent.click(screen.getByTestId('cc-nav-scoring'))
    expect(screen.getByText('editor for scoring')).toBeTruthy()
    fireEvent.click(screen.getByTestId('cc-tool-roster-locks'))
    expect(screen.getByTestId('cc-pane').getAttribute('data-subpage')).toBe('commissioner-tools')
  })

  it('in-season tools read In season before the draft and Ready after', () => {
    renderCenter(input(), false)
    expect(screen.getByTestId('cc-tool-edit-lineups').textContent).toMatch(/In season/)
  })

  it('offers Survivor tribes only for a Survivor league', () => {
    renderCenter(input())
    expect(screen.queryByTestId('cc-nav-survivor-tribes')).toBeNull()
  })

  it('makes Pirate rules directly reachable in the sidebar and mobile category picker', () => {
    renderCenter(input({ leagueVariant: 'pirate' }))
    fireEvent.click(screen.getByTestId('cc-nav-pirate-rules'))
    expect(screen.getByText('editor for pirate-rules')).toBeTruthy()
    expect((screen.getByLabelText('Settings category') as HTMLSelectElement).value).toBe('pirate-rules')
    fireEvent.change(screen.getByLabelText('Settings category'), { target: { value: 'roster' } })
    expect(screen.getByText('editor for roster')).toBeTruthy()
    expect(screen.getByTestId('cc-nav-roster').textContent).toBe('Roster settings')
  })

  it('a Survivor league gets the tribe setup entry (handoff §5.4)', () => {
    renderCenter(input({ leagueVariant: 'survivor' }))
    fireEvent.click(screen.getByTestId('cc-nav-survivor-tribes'))
    expect(screen.getByText('editor for survivor-tribes')).toBeTruthy()
  })

  it('never offers a section the builder gave no editor for (a member list has no targets)', () => {
    renderCenter(input({}, false))
    expect(screen.queryByTestId('cc-nav-draft')).toBeNull()
    expect(screen.queryByTestId('cc-tool-roster-locks')).toBeNull()
  })

  it('shows managers joined against league size with the copy invite action', () => {
    renderCenter(input())
    expect(screen.getByText(/\/ 12 joined/)).toBeTruthy()
    expect(screen.getByTestId('cc-copy-invite')).toBeTruthy()
  })
})
