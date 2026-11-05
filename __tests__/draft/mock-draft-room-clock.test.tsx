import React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import MockDraftSleeperRoomClient, { mockPicksUntilSlot } from '@/components/mock-draft/MockDraftSleeperRoomClient'

/*
 * The mock room speaks the live room's clock language (2026-11-05): the pick, who is on the clock,
 * how far away your turn is, and a bar for the time left on your own turn.
 */

const key = 'af:mock-draft:v1:viewer:open'
const team = (slot: number, isUser: boolean) => ({
  slot, managerId: String(slot), managerName: `Manager ${slot}`, avatarUrl: null, isUser, isAI: !isUser,
  role: 'member', isOrphan: false, picks: [], rosterNeeds: [],
})
function seed(state: Record<string, unknown>) {
  localStorage.clear()
  localStorage.setItem(key, JSON.stringify({
    version: 1, mode: 'open', queue: [] as string[], draftId: null, shareId: null,
    state: {
      settings: { teamCount: 4, rounds: 2, draftType: 'snake', sport: 'NBA', scoring: 'Points', superflex: false, myPickSlot: 1, speed: 15 },
      teams: [team(1, true), team(2, false), team(3, false), team(4, false)],
      availablePlayers: ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliet'].map((name, index) => ({ id: name, name, position: 'PG', team: 'LAL', adp: index + 1, projectedPts: 80, ownership: 10, injuryStatus: null, tier: 1, posRank: 'PG1', isRookie: false })),
      picks: [], currentPick: 1, onTheClock: 1, timerSeconds: 15, chatMessages: [],
      ...state,
    },
  }))
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ leagues: [] }), { status: 200 })))
}
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('mockPicksUntilSlot', () => {
  const teams = [1, 2, 3, 4].map((slot) => team(slot, slot === 1)) as never
  const settings = { teamCount: 4, rounds: 2, draftType: 'snake' } as never
  it('counts picks to a slot along the snake, and is 0 on the clock', () => {
    expect(mockPicksUntilSlot(teams, settings, 1, 1)).toBe(0)
    expect(mockPicksUntilSlot(teams, settings, 1, 4)).toBe(3)
    // Round 2 reverses: slot 4 picks 5th overall, slot 1 picks 8th.
    expect(mockPicksUntilSlot(teams, settings, 5, 4)).toBe(0)
    expect(mockPicksUntilSlot(teams, settings, 5, 1)).toBe(3)
  })
  it('is null once the slot has no turn left', () => {
    expect(mockPicksUntilSlot(teams, settings, 8, 2)).toBeNull()
  })
})

describe('mock room clock bar', () => {
  it('a paused room names the pick and says paused, with no timer to show', async () => {
    seed({ status: 'paused', pausedRemainingMs: 15000, turnDeadlineMs: null })
    render(<MockDraftSleeperRoomClient viewerId="viewer" />)
    await screen.findByTestId('mock-draft-resume')
    expect(screen.getByTestId('mock-draft-current-pick')).toHaveTextContent('Pick #1')
    expect(screen.getByTestId('mock-draft-clock-status')).toHaveTextContent('Paused')
    expect(screen.queryByTestId('mock-draft-clock')).toBeNull()
    expect(screen.getByTestId('draft-room-mock-banner')).toBeInTheDocument()
  })

  it('on your turn it says so and shows the time left with its bar', async () => {
    // A restored draft always comes back paused; Resume puts you on the clock.
    seed({ status: 'paused', pausedRemainingMs: 15000, turnDeadlineMs: null })
    const { container } = render(<MockDraftSleeperRoomClient viewerId="viewer" />)
    fireEvent.click(await screen.findByTestId('mock-draft-resume'))
    await screen.findByTestId('mock-draft-pause')
    expect(screen.getByTestId('mock-draft-clock-status')).toHaveTextContent('You are on the clock')
    expect(screen.getByTestId('mock-draft-clock').textContent).toMatch(/^\d+s left$/)
    expect(container.querySelector('.af-dr-clockbar-progress > span')).not.toBeNull()
  })

  it('the inline mock board page paints its own dark ground and opts out of the light clamp', () => {
    const src = readFileSync(resolve(__dirname, '../../app/draft/room/[draftId]/page.tsx'), 'utf8')
    expect(src).toMatch(/className="af-draft-dark min-h-screen bg-\[#070b16\]/)
  })
})
