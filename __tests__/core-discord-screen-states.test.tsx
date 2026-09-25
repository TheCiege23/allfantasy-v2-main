import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

/*
 * E2 + E6 (hands-on chat test, 2026-09-25) on `/core/discord?league=<id>` — the link the chat
 * drawer's Discord tab sends a commissioner to.
 *
 * The page did `getDiscordBridge(...).catch(() => null)` and rendered ONE panel for every null:
 * "Pick a league you commission from the rail." So a commissioner whose read failed (the database
 * was down during the test) was told to pick a league — with the league already picked in the URL,
 * which read exactly as though `?league=` had been dropped. A member who is not the commissioner got
 * the same words. Three different situations, one misleading sentence.
 *
 * Now the screen is scoped to the league in the URL whenever the user can see it (the page's rail
 * gate still drops an id they cannot), and each state says what is actually true.
 */

const h = vi.hoisted(() => ({ getDiscordBridge: vi.fn() }))
vi.mock('@/lib/core-app/discordBridge', () => ({ getDiscordBridge: h.getDiscordBridge }))

import { loadDiscordBridgeScreen } from '@/lib/core-app/discordBridgeScreen'
import { DiscordBridgeNotice } from '@/components/core-app/screens/DiscordBridgeNotice'

const LEAGUE = { id: 'lg-1', name: 'Sunday Squad' }
const BRIDGE = { leagueId: 'lg-1', leagueName: 'Sunday Squad' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('loadDiscordBridgeScreen', () => {
  it('reads the bridge for the league in the URL', async () => {
    h.getDiscordBridge.mockResolvedValueOnce(BRIDGE)
    const out = await loadDiscordBridgeScreen('u1', LEAGUE)
    expect(h.getDiscordBridge).toHaveBeenCalledWith('u1', 'lg-1')
    expect(out).toEqual({ state: 'ready', data: BRIDGE })
  })

  it('a failed read is "unavailable" for THAT league — not "pick a league"', async () => {
    h.getDiscordBridge.mockRejectedValueOnce(new Error("Can't reach database server at db.internal:5432"))
    const out = await loadDiscordBridgeScreen('u1', LEAGUE)
    expect(out).toEqual({ state: 'unavailable', league: LEAGUE })
  })

  it('a league the user plays in but does not run is "not-commissioner", named', async () => {
    h.getDiscordBridge.mockResolvedValueOnce(null)
    const out = await loadDiscordBridgeScreen('u1', LEAGUE)
    expect(out).toEqual({ state: 'not-commissioner', league: LEAGUE })
  })

  it('no league in the URL (or one the rail gate dropped) asks for one, and reads nothing', async () => {
    const out = await loadDiscordBridgeScreen('u1', null)
    expect(out).toEqual({ state: 'no-league' })
    expect(h.getDiscordBridge).not.toHaveBeenCalled()
  })
})

describe('DiscordBridgeNotice', () => {
  it('unavailable: says it could not load, offers Try again on the SAME league, and names no internals', () => {
    render(<DiscordBridgeNotice screen={{ state: 'unavailable', league: LEAGUE }} />)
    expect(screen.getByText("Couldn't load your Discord setup. Try again.")).toBeTruthy()
    expect(screen.queryByText(/Pick a league you commission/)).toBeNull()
    const retry = screen.getByRole('link', { name: /try again/i })
    expect(retry.getAttribute('href')).toBe('/core/discord?league=lg-1')
    expect(document.body.textContent).not.toMatch(/\b5\d\d\b|database|prisma/i)
  })

  it('not-commissioner: names the league and says who can set it up', () => {
    render(<DiscordBridgeNotice screen={{ state: 'not-commissioner', league: LEAGUE }} />)
    expect(screen.getByText(/Sunday Squad/)).toBeTruthy()
    expect(screen.getByText(/commissioner/i)).toBeTruthy()
    expect(screen.queryByText(/Pick a league you commission/)).toBeNull()
    expect(screen.queryByRole('link', { name: /try again/i })).toBeNull()
  })

  it('no-league: keeps the pick-a-league guidance', () => {
    render(<DiscordBridgeNotice screen={{ state: 'no-league' }} />)
    expect(screen.getByText(/Pick a league you commission from the rail/)).toBeTruthy()
  })
})
