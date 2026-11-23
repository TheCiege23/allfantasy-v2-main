/**
 * Zombie after the 2026-11-23 audit: the always-dark Zombie scene reads in light mode, player screens speak in plain
 * words (no "Combat & Whisperer command", no QA rehearsal, no raw server errors), your matchup comes before league
 * business, the outbreak grid shows names, one row of navigation, the bash/maul meter never stacks two labels, the
 * War Room fits mid-season, and the full hub says each thing once.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

vi.mock('next/link', () => ({ default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...rest}>{children}</a> }))

import { ZombieRoleActions } from '@/components/zombie/ZombieRoleActions'
import { ZombieSeasonOperations } from '@/components/zombie/ZombieSeasonOperations'
import { ZombieBashingCard } from '@/components/zombie/ZombieBashingCard'
import { ZombieWarRoomShortcuts } from '@/components/zombie/ZombieWarRoomShortcuts'

const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8')
const failing = () => vi.fn(async () => new Response(JSON.stringify({ error: 'harness' }), { status: 503, headers: { 'Content-Type': 'application/json' } }))

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('light mode: the Zombie scene stays dark', () => {
  it('the tab content and header opt out of the light-mode remap and carry dark tokens', () => {
    const ws = read('components/league/native/NativeLeagueWorkspace.tsx')
    expect(ws).toMatch(/nl-tab-content\$\{zombieBanner \? ' af-draft-dark' : ''\}/)
    expect(ws).toMatch(/nl-league-heading\$\{zombieBanner \? ' af-draft-dark' : ''\}/)
    expect(read('components/league/native/zombie-workspace.css')).toMatch(/\.nl-workspace\[data-format=zombie\] \.nl-tab-content,[^{]*\{[^}]*--text:\s*#eef0fa/)
  })
})

describe('plain words on player screens', () => {
  it('decisions card: no ops wording, and a failed load is not the server’s raw error', async () => {
    expect(read('components/zombie/ZombieRoleActions.tsx')).not.toMatch(/Combat &amp; Whisperer command|2025 NFL rules · role choices|Refresh decisions/)
    vi.stubGlobal('fetch', failing())
    render(<ZombieRoleActions leagueId="L1" />)
    await waitFor(() => expect(screen.getByText(/didn’t load/)).toBeTruthy())
    expect(document.body.textContent).not.toMatch(/harness/)
  })
  it('league business: no QA rehearsal or ops wording, and nothing at all when it fails to load', async () => {
    const src = read('components/zombie/ZombieSeasonOperations.tsx')
    expect(src).not.toMatch(/Manager acceptance rehearsal|accounting, universe votes, owner recovery and acceptance|Refresh operations|Loading season operations/)
    vi.stubGlobal('fetch', failing())
    const { container } = render(<ZombieSeasonOperations leagueId="L1" />)
    await new Promise((r) => setTimeout(r, 20))
    expect(container.textContent).toBe('')
  })
  it('full hub: no "Shadow asset", "Identity classified" or "Command summary"', () => {
    expect(read('components/zombie/ZombieCommandHero.tsx')).not.toMatch(/Shadow asset/)
    expect(read('app/zombie/components/ZombieWhispererCard.tsx')).not.toMatch(/Identity classified/)
    expect(read('app/zombie/[leagueId]/ZombieLeagueHomeClient.tsx')).not.toMatch(/title="Command summary"/)
  })
})

describe('the Zombie tab', () => {
  const src = () => read('components/zombie/ZombieHome.tsx')
  it('puts your matchup before league business and the universe map', () => {
    const s = src()
    expect(s.indexOf('id="zombie-week-matchup"')).toBeGreaterThan(0)
    expect(s.indexOf('id="zombie-week-matchup"')).toBeLessThan(s.indexOf('<ZombieSeasonOperations'))
    expect(s.indexOf('id="zombie-week-matchup"')).toBeLessThan(s.indexOf('<ZombieUniverseMap'))
  })
  it('one navigation row: no second Matchups/Items/Rules/Chat chip row', () => {
    expect(src()).not.toMatch(/aria-label="Zombie league"/)
  })
  it('the outbreak grid wraps names instead of cutting them to "The …"', () => {
    expect(src()).not.toMatch(/block truncate text-\[13px\] font-semibold/)
    expect(src()).toMatch(/line-clamp-2/)
  })
})

describe('the bash/maul meter', () => {
  it('one marker and one label when the two lines are the same number', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const side = (rosterId: string, name: string, score: number) => ({ rosterId, name, status: 'Survivor', score })
    render(
      <ZombieBashingCard
        m={{ id: 'm1', home: side('a', 'Alpha', 120), away: side('b', 'Bravo', 80), final: false, margin: 40, leader: 'home', atRisk: null, outcome: null, transfer: null, mySide: 'home' } as never}
        rules={{ bashingThreshold: 60, maulingThreshold: 60, bashShare: 1, maulShare: 1 }}
      />,
    )
    expect(screen.getByText('Bash or maul 60')).toBeTruthy()
    expect(screen.queryByText('Bash 60')).toBeNull()
    expect(errors.mock.calls.flat().join(' ')).not.toMatch(/same key/)
    errors.mockRestore()
  })
})

describe('the War Room', () => {
  it('no draft wording mid-season', () => {
    expect(read('components/league/native/NativeLeagueWorkspace.tsx')).not.toMatch(/war_room: \{ label: 'Strategy bunker', detail: 'Plan your draft/)
  })
  it('"1 weapon", not "1 weapons"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      myRosterId: 'r1', myStatus: 'Survivor', revivedRosterIds: [], myResources: { serums: 1, weapons: 1, ambush: 0 },
    }))))
    render(<ZombieWarRoomShortcuts leagueId="L1" />)
    await waitFor(() => expect(screen.getByText(/Your supplies/)).toBeTruthy())
    expect(screen.getByText(/Your supplies/).textContent).toBe('Your supplies: 1 serum · 1 weapon')
  })
})

describe('the full hub says each thing once', () => {
  it('no second LeagueSafe/FanCred pair and no "Jump to live surfaces" card', () => {
    const s = read('app/zombie/[leagueId]/ZombieLeagueHomeClient.tsx')
    expect(s).not.toMatch(/zombie-quick-leaguesafe|zombie-quick-fancred/)
    expect(s).not.toMatch(/Jump to live surfaces/)
  })
  it('the hero drops the survivor/horde/whisperer tiles the sidebar already counts', () => {
    expect(read('components/zombie/ZombieCommandHero.tsx')).not.toMatch(/label="Survivors"/)
  })
})
