import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

/*
 * The switching league's cards (components/league-home/SwitchingLeagueCard.tsx): the head commissioner's
 * "Make it official" in season, one switch card at a time in the Commissioner tab, and a manager's own
 * "Switch to AllFantasy".
 */
import {
  ImportedLeagueSwitchCard,
  SwitchingLeagueCommissionerView,
  SwitchingLeagueTeamView,
  type SwitchingState,
} from '@/components/league-home/SwitchingLeagueCard'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const inSeason: SwitchingState = {
  applies: true, official: false, seasonInProgress: true, platformLabel: 'Sleeper', isHeadCommissioner: true,
  myTeam: { name: 'Ghosts', switched: false }, teams: [], invitePath: null,
}

describe('the commissioner card', () => {
  it('asks once more before making it official, then posts and reloads', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }))
    vi.stubGlobal('fetch', fetchMock)
    const onChanged = vi.fn()
    render(<SwitchingLeagueCommissionerView leagueId="L1" state={inSeason} onChanged={onChanged} />)

    expect(screen.getByText('Make AllFantasy your official league')).toBeTruthy()
    fireEvent.click(screen.getByText('Make it official'))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.getByText("This can't be undone.")).toBeTruthy()
    fireEvent.click(screen.getByText('Yes, make it official'))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledWith('/api/leagues/L1/switching', { method: 'POST' })
  })

  it("shows the refusal's reason and stays as it was", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({ error: 'Claim your own team first.' }) })))
    const onChanged = vi.fn()
    render(<SwitchingLeagueCommissionerView leagueId="L1" state={inSeason} onChanged={onChanged} />)
    fireEvent.click(screen.getByText('Make it official'))
    fireEvent.click(screen.getByText('Yes, make it official'))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe('Claim your own team first.')
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('once official: the invite link and who is still on the old platform', () => {
    render(
      <SwitchingLeagueCommissionerView
        leagueId="L1"
        onChanged={() => {}}
        state={{ ...inSeason, official: true, invitePath: '/join/tok', teams: [
          { name: 'Ghosts', manager: 'A', switched: true },
          { name: 'Owls', manager: 'B', switched: false },
        ] }}
      />,
    )
    expect(screen.getByText('AllFantasy is your official league')).toBeTruthy()
    expect(screen.getByText(/\/join\/tok$/)).toBeTruthy()
    expect(screen.getByTestId('switching-still-copying').textContent).toBe('Owls · B')
  })
})

describe('one switch card at a time in the Commissioner tab', () => {
  const offseason = <p>offseason switch card</p>
  const withState = (state: Partial<SwitchingState>) =>
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ...inSeason, ...state }) })))

  it('in season: Make it official, not the offseason card', async () => {
    withState({})
    render(<ImportedLeagueSwitchCard leagueId="L1" offseasonCard={offseason} />)
    expect(await screen.findByText('Make AllFantasy your official league')).toBeTruthy()
    expect(screen.queryByText('offseason switch card')).toBeNull()
  })

  it('[control] in the offseason: the in-place switch card', async () => {
    withState({ seasonInProgress: false })
    render(<ImportedLeagueSwitchCard leagueId="L1" offseasonCard={offseason} />)
    expect(await screen.findByText('offseason switch card')).toBeTruthy()
    expect(screen.queryByText('Make AllFantasy your official league')).toBeNull()
  })
})

describe("a manager's team card", () => {
  it('says moves are practice before the league is official, and switches on a tap', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }))
    vi.stubGlobal('fetch', fetchMock)
    const onChanged = vi.fn()
    render(<SwitchingLeagueTeamView leagueId="L1" state={{ ...inSeason, isHeadCommissioner: false }} onChanged={onChanged} />)
    expect(screen.getByText('Run Ghosts on AllFantasy')).toBeTruthy()
    expect(screen.getByText(/moves here are practice/)).toBeTruthy()
    fireEvent.click(screen.getByText('Switch to AllFantasy'))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledWith('/api/leagues/L1/switching/team', { method: 'POST' })
  })

  it('shows nothing once the team switched in an official league', () => {
    const { container } = render(
      <SwitchingLeagueTeamView leagueId="L1" state={{ ...inSeason, official: true, myTeam: { name: 'Ghosts', switched: true } }} onChanged={() => {}} />,
    )
    expect(container.textContent).toBe('')
  })
})
