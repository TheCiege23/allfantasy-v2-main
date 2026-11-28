/**
 * League settings → "Keepers & carryover" (2026-11-22, keeper audit items 2 and 8).
 *
 * The window was hard-coded dark (bg-[#0c1220], text-white*); in light mode app/globals.css turned its text dark
 * on the still-dark panel, so team names, players and the buttons could not be read. It also showed a checkbox
 * beside every player that was permanently disabled and did nothing, and printed developer copy for an empty
 * roster: "No structured players in roster payload (import/sync may be required)."
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}))

import { KeeperModal } from '@/app/league/[leagueId]/tabs/settings/KeeperModal'

const TEAMS = [
  { id: 't1', teamName: 'Second Chance Saloon', ownerName: 'You', claimedByUserId: 'u1' },
  { id: 't2', teamName: 'Empty Bench', ownerName: 'Sam', claimedByUserId: 'u2' },
  { id: 't3', teamName: 'Open Team', ownerName: null, claimedByUserId: null },
]

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const roster = url.includes('userId=u1') ? { players: [{ playerId: 'p1', name: 'Puka Nacua' }, { playerId: 'p2', name: 'Bijan Robinson' }] } : { players: [] }
    return new Response(JSON.stringify({ roster }), { status: 200, headers: { 'content-type': 'application/json' } })
  }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function modal() {
  render(<KeeperModal open leagueId="L" teams={TEAMS as never} onClose={() => undefined} />)
  await screen.findByText('Puka Nacua')
  return screen.getByRole('dialog', { name: /Keepers & carryover/ })
}

describe('Keepers & carryover window', () => {
  it('is a labelled dialog', async () => {
    expect(await modal()).toBeTruthy()
  })

  it('uses no class the global light-mode rule rewrites, and no hard-coded hex colour', async () => {
    const el = await modal()
    const offenders = [el.parentElement!, el, ...Array.from(el.querySelectorAll('*'))]
      .map((n) => n.getAttribute('class') ?? '')
      .filter((c) => /text-white|bg-\[#|text-\[#|border-\[#|bg-black|text-red-/.test(c))
    expect(offenders).toEqual([])
  })

  it('lists players without dead checkboxes', async () => {
    const el = await modal()
    expect(within(el).queryAllByRole('checkbox')).toHaveLength(0)
    expect(within(el).getByText('Bijan Robinson')).toBeTruthy()
  })

  it('says an empty roster and an open team in plain words', async () => {
    const el = await modal()
    expect(el.textContent).not.toMatch(/payload|import\/sync|structured/i)
    expect(within(el).getByTestId('keeper-carryover-team-t2').textContent).toMatch(/No players on this roster yet/)
    expect(within(el).getByTestId('keeper-carryover-team-t3').textContent).toMatch(/No manager yet/)
  })
})
