/**
 * Devy league screens, 2026-11-07 visual audit (phone + desktop, dark + light, DB-free harness at
 * /e2e/devy/[leagueId]/[screen]).
 *
 * 1. Always dark: the light-mode clamp recoloured parts of these dark screens near-invisible. The new league
 *    layout carries `af-draft-dark`, as C2C's does.
 * 2. History was a static placeholder shown to every devy league as its own ("2025 season · Imported from
 *    Sleeper (preview)", "Team name · Manager"). The header links to the league's real history and the old
 *    URL redirects there.
 * 3. Picks named every owner by the first characters of a roster id — the board's column headers, the
 *    table's source and owner, the pick sheet. They now show team names ("You" for your own).
 * 4. Internal wording reached users: a table name ("(player_weekly_scores)"), the plan's code ("AfSub"),
 *    "(wiring soon)"; and a projected declaration year read as a fact ("NFL entry: 2027").
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const redirect = vi.fn((to: string) => {
  throw new Error(`REDIRECT ${to}`)
})
vi.mock('next/navigation', async (orig) => ({ ...(await orig<typeof import('next/navigation')>()), redirect: (to: string) => redirect(to) }))

import DevyLeagueLayout from '@/app/devy/[leagueId]/layout'
import DevyHistoryPage from '@/app/devy/[leagueId]/history/page'
import { DevyPicksClient } from '@/app/devy/[leagueId]/picks/DevyPicksClient'
import { DevyPlayerCard } from '@/app/devy/components/DevyPlayerCard'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const src = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8')

describe('Devy league is dark in every mode', () => {
  it('wraps every league screen in the always-dark opt-out', () => {
    const { container } = render(<DevyLeagueLayout><p>screen</p></DevyLeagueLayout>)
    expect((container.firstElementChild as HTMLElement).className.split(/\s+/)).toContain('af-draft-dark')
  })
})

describe('Devy history', () => {
  it('sends the old URL to the league history', async () => {
    await expect(DevyHistoryPage({ params: Promise.resolve({ leagueId: 'L 1' }) })).rejects.toThrow('REDIRECT /league/L%201?view=history')
  })

  it('links the league header to the real history, not the placeholder', () => {
    const shell = src('app/league/[leagueId]/LeagueShell.tsx')
    expect(shell).not.toContain('/devy/${leagueId}/history')
    const devyBlock = shell.slice(shell.indexOf("['Roster', `/devy/${leagueId}/roster`]"))
    expect(devyBlock.slice(0, 600)).toContain("['History', `/league/${leagueId}?view=history`]")
  })
})

describe('Devy picks', () => {
  const ROSTERS = [
    { id: 'ckdevyroster00001', ownerId: 'me', teamName: 'Future Is Now' },
    { id: 'ckdevyroster00002', ownerId: 'u2', teamName: 'The Long Game' },
  ]
  const pick = (id: string, round: number, pickType: string, original: string, current: string) =>
    ({ id, season: 2026, round, pickType, originalOwnerId: original, currentOwnerId: current, isTradeable: true, isUsed: false })
  const mine = [pick('a', 1, 'rookie', ROSTERS[1]!.id, ROSTERS[0]!.id), pick('b', 1, 'devy', ROSTERS[0]!.id, ROSTERS[0]!.id)]
  const all = [...mine, pick('c', 2, 'rookie', ROSTERS[1]!.id, ROSTERS[1]!.id)]

  function stubApi() {
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const url = String(input)
      const json = (body: unknown) => ({ ok: true, json: async () => body })
      if (url.startsWith('/api/devy/picks') && url.includes('type=all')) return json({ picks: all })
      if (url.startsWith('/api/devy/picks')) return json({ inventory: { years: [{ year: 2026, rookiePicks: [mine[0]], devyPicks: [mine[1]] }] } })
      if (url.startsWith('/api/devy')) return json({ config: { season: 2026, futureDraftFormat: 'separate' } })
      if (url.startsWith('/api/redraft/season')) return json({ season: { rosters: ROSTERS } })
      return { ok: false, json: async () => ({}) }
    }))
  }

  it('names the team behind every pick, in the table and on the league board', async () => {
    stubApi()
    const { container } = render(<DevyPicksClient leagueId="L1" userId="me" />)
    await screen.findByText('The Long Game')
    expect(container.textContent).not.toContain('ckdevy')
    fireEvent.click(screen.getByText('League board'))
    const headers = [...container.querySelectorAll('thead th')].map((th) => th.textContent)
    expect(headers).toEqual(expect.arrayContaining(['You', 'The Long Game']))
    expect(container.textContent).not.toContain('ckdevy')
  })
})

describe('Devy user-facing copy', () => {
  it('says a declaration year is a projection', () => {
    render(
      <DevyPlayerCard variant="devy" playerId="d1" name="Arch Manning" position="QB" subtitle="Texas" classYear="JR" projectedYear={2027} />,
    )
    expect(document.body.textContent).toContain('Projected NFL entry: 2027')
  })

  it.each([
    'app/devy/[leagueId]/roster/DevyRosterClient.tsx',
    'app/devy/components/DevyPlayerModal.tsx',
    'app/devy/components/settings/DevyAIPanel.tsx',
  ])('%s carries no table names, plan codes or "wiring"', (rel) => {
    const s = src(rel)
    expect(s).not.toMatch(/player_weekly_scores\)/)
    expect(s).not.toMatch(/\bAfSub\b(?!Gate)(?=[.)\s])/)
    expect(s).not.toMatch(/wiring soon/)
  })
})
