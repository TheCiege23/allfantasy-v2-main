import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DraftRoomShell } from '@/components/app/draft-room/DraftRoomShell'
import { DraftPlayerCard } from '@/components/app/draft-room/DraftPlayerCard'
import { positionTintHex } from '@/lib/draft-room/positionTint'

/*
 * 2026-10-28 report on NBA/NHL zombie drafts: rectangular, colourless board tiles; a red
 * UNKNOWN chip and "Bye —" on every player; and no way to give the pool or chat more room.
 */

vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useLanguage: () => ({ t: (key: string) => key.split('.').pop() }),
  useOptionalLanguage: () => ({ language: 'en' }),
}))

beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
  window.localStorage.clear()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderShell(surfaceVariant: 'default' | 'redraft_snake' = 'redraft_snake') {
  render(
    <DraftRoomShell
      layout="premium"
      surfaceVariant={surfaceVariant}
      topBar={null}
      managerStrip={null}
      draftBoard={<div>Board</div>}
      playerPanel={<div>Players</div>}
      queuePanel={<div>Queue</div>}
      chatPanel={<div>Chat</div>}
      teamPanel={null}
      centerColumn={<div>Pool and chat</div>}
      mobileTab="board"
      onMobileTabChange={vi.fn()}
    />,
  )
  return screen.getByTestId('draft-premium-board-zone')
}

describe('draft room panel size', () => {
  it('offers board / half / players sizes in the redraft room, which used to have no control', () => {
    const zone = renderShell('redraft_snake')
    expect(zone.getAttribute('data-dock-size')).toBe('half')
    fireEvent.click(screen.getByTestId('draft-dock-size-tall'))
    expect(zone.getAttribute('data-dock-size')).toBe('tall')
    expect(screen.getByTestId('draft-premium-main-zones').getAttribute('data-dock-expanded')).toBe('true')
    fireEvent.click(screen.getByTestId('draft-dock-collapse-toggle'))
    expect(zone.getAttribute('data-dock-size')).toBe('min')
    expect(screen.getByTestId('draft-premium-main-zones').getAttribute('data-dock-expanded')).toBe('false')
    fireEvent.click(screen.getByTestId('draft-dock-size-half'))
    expect(zone.getAttribute('data-dock-size')).toBe('half')
  })

  it('keeps the board selector and panel presets in one consistent state', () => {
    const zone = renderShell()
    const shell = screen.getByTestId('draft-room-shell')
    fireEvent.change(screen.getByRole('combobox', { name: 'Draft board size' }), { target: { value: 'hidden' } })
    expect(shell.getAttribute('data-board-size')).toBe('hidden')
    expect(zone.getAttribute('data-dock-size')).toBe('tall')
    fireEvent.click(screen.getByTestId('draft-dock-collapse-toggle'))
    expect(zone.getAttribute('data-dock-size')).toBe('min')
    expect(shell.getAttribute('data-board-size')).not.toBe('hidden')
    fireEvent.change(screen.getByRole('combobox', { name: 'Draft board size' }), { target: { value: 'balanced' } })
    expect(zone.getAttribute('data-dock-size')).toBe('half')
    fireEvent.click(screen.getByTestId('draft-dock-size-tall'))
    expect((screen.getByRole('combobox', { name: 'Draft board size' }) as HTMLSelectElement).value).toBe('compact')
    expect(shell.getAttribute('data-board-size')).toBe('compact')
  })

  it('migrates the older compact board preference into the larger player panel', () => {
    window.localStorage.setItem('af:draft-board-size', 'compact')
    const zone = renderShell()
    expect(zone.getAttribute('data-dock-size')).toBe('tall')
    expect(screen.getByTestId('draft-room-shell').getAttribute('data-board-size')).toBe('compact')
  })

  it('remembers the chosen size', () => {
    renderShell()
    fireEvent.click(screen.getByTestId('draft-dock-size-tall'))
    cleanup()
    const zone = renderShell()
    expect(zone.getAttribute('data-dock-size')).toBe('tall')
  })

  it('reads the older collapsed preference as the board-only size', () => {
    window.localStorage.setItem('af:draft-premium-bottom-dock-expanded', '0')
    window.localStorage.setItem('af:draft-board-size', 'compact')
    const zone = renderShell()
    expect(zone.getAttribute('data-dock-size')).toBe('min')
  })
})

function card(props: Partial<React.ComponentProps<typeof DraftPlayerCard>>) {
  render(
    <DraftPlayerCard
      name="Aaron Gordon"
      position="PF"
      team="DEN"
      adp={null}
      byeWeek={null}
      draftSport="NBA"
      testId="card"
      {...props}
    />,
  )
}

describe('draft pool player card', () => {
  it('shows no injury chip for an UNKNOWN status', () => {
    card({ unifiedProductView: { injuryStatus: 'UNKNOWN', unified: { injuryStatus: 'UNKNOWN' } } as never })
    expect(screen.queryByTestId('card-injury-status')).toBeNull()
  })

  it('still shows a real injury designation', () => {
    card({ unifiedProductView: { injuryStatus: 'Questionable', unified: { injuryStatus: 'Questionable' } } as never })
    expect(screen.getByTestId('card-injury-status').textContent).toBe('Questionable')
  })

  it('shows Bye only for football', () => {
    card({ draftSport: 'NBA' })
    expect(screen.queryByTestId('card-bye')).toBeNull()
    cleanup()
    card({ draftSport: 'NFL', position: 'WR', byeWeek: 7 })
    expect(screen.getByTestId('card-bye').textContent).toBe('7')
  })

  it('shows the AI ADP value under the AI ADP label', () => {
    card({ adp: 12.4, adpMetricLabel: 'AI ADP' })
    expect(screen.getByTestId('card-adp').textContent).toBe('12.4')
  })

  it('does not put the display model primary stat under the AI ADP label', () => {
    // Before: the cell read normalized.adp, which falls back to stats.primaryStatValue (FPPG here).
    card({
      adp: null,
      adpMetricLabel: 'AI ADP',
      display: { stats: { primaryStatValue: 31.7, primaryStatLabel: 'FPPG' }, metadata: {}, assets: {} } as never,
    })
    expect(screen.queryByTestId('card-adp')).toBeNull()
  })
})

describe('position tile colours', () => {
  it('colours every sport, and gives unknown positions a stable colour', () => {
    for (const pos of ['QB', 'PG', 'C', 'LW', 'D', 'G', 'SP', 'SS', 'GK', 'MID', 'FWD']) {
      expect(positionTintHex(pos)).toMatch(/^#[0-9a-f]{6}$/)
    }
    expect(positionTintHex('XYZ')).toBe(positionTintHex('XYZ'))
    expect(positionTintHex(null)).toBeNull()
    expect(positionTintHex('—')).toBeNull()
  })
})
