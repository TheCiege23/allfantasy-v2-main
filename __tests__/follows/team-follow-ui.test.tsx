import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

/*
 * The "follow your teams" prompt (My Team, once) and Settings › Notifications › "Teams you follow".
 * Both run on useTeamFollows over /api/user/team-follows.
 */

import { TeamFollowPrompt } from '@/components/follows/TeamFollowPrompt'
import TeamFollowsSettingsCard from '@/components/settings/TeamFollowsSettingsCard'

type Follow = { sport: string; teamAbbr: string; teamName: string }
let follows: Follow[] | null
let posts: Array<Record<string, unknown>>
let postStatus: number

beforeEach(() => {
  follows = []
  posts = []
  postStatus = 200
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts.push(JSON.parse(String(init.body)))
        return new Response(JSON.stringify(postStatus === 200 ? { ok: true } : { error: 'You can follow up to 30 teams.' }), {
          status: postStatus,
        })
      }
      const sport = new URL(url, 'https://x.test').searchParams.get('sport')
      const teams =
        sport === 'NBA'
          ? [{ abbr: 'BOS', name: 'Boston Celtics' }]
          : sport === 'NCAAF'
            ? [{ abbr: 'ALA', name: 'Alabama' }]
            : [
              { abbr: 'CHI', name: 'Chicago Bears' },
              { abbr: 'GB', name: 'Green Bay Packers' },
            ]
      return new Response(JSON.stringify({ sports: ['NFL', 'NBA', 'NCAAF'], max: 30, teams, follows }))
    }),
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  document.body.style.overflow = ''
})

describe('the My Team prompt', () => {
  it('renders nothing when not eligible', () => {
    render(<TeamFollowPrompt eligible={false} />)
    expect(screen.queryByTestId('team-follow-prompt')).toBeNull()
  })

  it('tapping a team follows it at once; switching sport shows that sport\'s teams', async () => {
    render(<TeamFollowPrompt eligible />)
    fireEvent.click(await screen.findByTestId('team-follow-NFL-GB'))
    await waitFor(() => expect(posts).toContainEqual({ action: 'follow', sport: 'NFL', teamAbbr: 'GB' }))
    expect(screen.getByTestId('team-follow-NFL-GB').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('team-follow-count').textContent).toMatch(/1/)
    fireEvent.click(screen.getByTestId('team-follow-sport-NBA'))
    expect(await screen.findByTestId('team-follow-NBA-BOS')).toBeTruthy()
  })

  it('opens on the sport the server chose — College Football for a college fan', async () => {
    render(<TeamFollowPrompt eligible initialSport="NCAAF" />)
    expect(await screen.findByTestId('team-follow-NCAAF-ALA')).toBeTruthy()
    const first = String((fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0])
    expect(new URL(first, 'https://x.test').searchParams.get('sport')).toBe('NCAAF')
    expect(screen.queryByTestId('team-follow-NFL-GB')).toBeNull()
  })

  it('"Done", "Not now" and Escape all record it as seen and close it', async () => {
    for (const close of [
      () => fireEvent.click(screen.getByTestId('team-follow-done')),
      () => fireEvent.click(screen.getByTestId('team-follow-not-now')),
      () => fireEvent.keyDown(document, { key: 'Escape' }),
    ]) {
      posts = []
      render(<TeamFollowPrompt eligible />)
      await screen.findByTestId('team-follow-NFL-GB')
      close()
      await waitFor(() => expect(screen.queryByTestId('team-follow-prompt')).toBeNull())
      expect(posts).toContainEqual({ action: 'dismissPrompt' })
      cleanup()
    }
  })

  it('a refused save reverts the team and says why', async () => {
    postStatus = 409
    render(<TeamFollowPrompt eligible />)
    fireEvent.click(await screen.findByTestId('team-follow-NFL-GB'))
    expect((await screen.findByRole('alert')).textContent).toMatch(/up to 30 teams/)
    expect(screen.getByTestId('team-follow-NFL-GB').getAttribute('aria-pressed')).toBe('false')
  })

  it('closes itself when follows are unavailable on the server (no table yet)', async () => {
    follows = null
    render(<TeamFollowPrompt eligible />)
    await waitFor(() => expect(screen.queryByTestId('team-follow-prompt')).toBeNull())
  })
})

describe('Settings › Teams you follow', () => {
  it('lists follows by sport and removes one', async () => {
    follows = [{ sport: 'NFL', teamAbbr: 'GB', teamName: 'Green Bay Packers' }]
    render(<TeamFollowsSettingsCard />)
    expect((await screen.findByTestId('team-follows-list')).textContent).toMatch(/Green Bay Packers/)
    fireEvent.click(screen.getByTestId('team-follows-remove-NFL-GB'))
    await waitFor(() => expect(posts).toContainEqual({ action: 'unfollow', sport: 'NFL', teamAbbr: 'GB' }))
    expect(await screen.findByTestId('team-follows-empty')).toBeTruthy()
  })

  it('"Add teams" opens the picker and follows from it', async () => {
    render(<TeamFollowsSettingsCard />)
    fireEvent.click(await screen.findByTestId('team-follows-add'))
    fireEvent.click(await screen.findByTestId('team-follows-pick-NFL-CHI'))
    await waitFor(() => expect(posts).toContainEqual({ action: 'follow', sport: 'NFL', teamAbbr: 'CHI' }))
  })

  it('is hidden entirely when follows are unavailable — never "you follow none"', async () => {
    follows = null
    const { container } = render(<TeamFollowsSettingsCard />)
    await waitFor(() => expect(container.querySelector('[data-testid="settings-team-follows"]')).toBeNull())
  })
})
