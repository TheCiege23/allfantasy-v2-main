/**
 * Phone sort control (2026-11-28). The desktop pool table sorts from its column headers; the phone
 * card list had no sort at all — Yahoo's 2026 app drew the same complaint ("you weren't able to
 * sort by average points per game last year"). The control drives the SAME sort state and keys as
 * the headers (`sortKeyForColumn`).
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useLanguage: () => ({ t: (key: string) => key.split('.').pop(), language: 'en' }),
  useOptionalLanguage: () => ({ t: (key: string) => key.split('.').pop(), language: 'en' }),
}))
import { PlayerPanel, type PlayerEntry } from '@/components/app/draft-room/PlayerPanel'
import { phonePoolSortOptions } from '@/components/app/draft-room/phonePoolSortOptions'

let phone = true
beforeEach(() => {
  phone = true
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: phone, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// ADP order Cole, Avery, Blake; name order Avery, Blake, Cole.
const players: PlayerEntry[] = [
  { id: 'p1', name: 'Cole Example', position: 'C', team: 'COL', adp: 1 },
  { id: 'p2', name: 'Avery Example', position: 'C', team: 'EDM', adp: 2 },
  { id: 'p3', name: 'Blake Example', position: 'C', team: 'TOR', adp: 3 },
]

function panel() {
  return render(
    <PlayerPanel players={players} draftedNames={new Set()} sport="NHL" canDraft={false} onAddToQueue={() => {}}
      onMakePick={() => {}} isPlayerQueued={() => false} poolLayout="card" presentationVariant="redraft_snake" />,
  )
}

/** Names in the order the list draws them. */
function order(container: HTMLElement): string[] {
  const text = container.textContent ?? ''
  return ['Avery Example', 'Blake Example', 'Cole Example'].sort((a, b) => text.indexOf(a) - text.indexOf(b))
}

describe('phonePoolSortOptions', () => {
  it('NHL skaters: ADP, then GP and FP/G first among the stats, HIT and PPP present, Name last', () => {
    const labels = phonePoolSortOptions('NHL', { position: 'C' }, false).map((o) => o.label)
    expect(labels[0]).toBe('ADP')
    expect(labels.slice(1, 3)).toEqual(['GP', 'FP/G'])
    expect(labels).toEqual(expect.arrayContaining(['HIT', 'PPP', 'BLK']))
    expect(labels.at(-1)).toBe('Name')
  })

  it('Chimmy ADP (the room’s own label) replaces ADP when the room shows it; keys never repeat', () => {
    const opts = phonePoolSortOptions('NHL', { position: 'G' }, true)
    expect(opts[0]).toEqual({ key: 'aiAdp', label: 'Chimmy ADP' })
    expect(new Set(opts.map((o) => o.key)).size).toBe(opts.length)
  })
})

describe('PlayerPanel phone sort control', () => {
  it('shows on a phone, starts on ADP, and re-sorts the card list', () => {
    const { container } = panel()
    const control = screen.getByTestId('draft-mobile-sort')
    const select = within(control).getByTestId('draft-mobile-sort-key') as HTMLSelectElement
    expect(select.value).toBe('adp')
    expect(order(container)).toEqual(['Cole Example', 'Avery Example', 'Blake Example'])

    fireEvent.change(select, { target: { value: 'name' } })
    expect(order(container)).toEqual(['Avery Example', 'Blake Example', 'Cole Example'])

    const dir = screen.getByTestId('draft-mobile-sort-direction')
    expect(dir.textContent).toBe('↑')
    fireEvent.click(dir)
    expect(dir.textContent).toBe('↓')
    expect(order(container)).toEqual(['Cole Example', 'Blake Example', 'Avery Example'])
  })

  it('is a 44px touch target and is not drawn on desktop, where the headers sort', () => {
    panel()
    expect(screen.getByTestId('draft-mobile-sort-key').className).toContain('min-h-[44px]')
    expect(screen.getByTestId('draft-mobile-sort-direction').className).toContain('min-h-[44px]')
    cleanup()
    phone = false
    panel()
    expect(screen.queryByTestId('draft-mobile-sort')).toBeNull()
  })

  it('search takes its own full row on a phone (sharing one squeezed it to "Search p…"), and stays inline on desktop', () => {
    panel()
    const search = screen.getByTestId('draft-player-search')
    const cls = search.className.split(/\s+/)
    expect(cls).toEqual(expect.arrayContaining(['w-full', 'basis-full', 'min-h-[44px]']))
    // `flex-1` would reset the basis to 0 and put it back beside Filters (measured in the room).
    expect(cls).not.toContain('flex-1')
    expect(search.contains(screen.getByTestId('draft-player-search-input'))).toBe(true)
    cleanup()
    phone = false
    panel()
    const desk = screen.getByTestId('draft-player-search').className.split(/\s+/)
    expect(desk).not.toContain('basis-full')
    expect(desk).toContain('flex-1')
  })

  it('the room stylesheet gives the phone search the whole row (it, not the class, decides the layout there)', () => {
    // draft-workspace.css overrides the component's classes inside .draft-touch-room; its rule was
    // `flex:1 1 0` (search beside Filters) and is what kept the field at 134px in the room.
    const css = readFileSync('components/app/draft-room/draft-workspace.css', 'utf8')
    const rules = [...css.matchAll(/\[data-testid="draft-player-toolbar"\]>div:first-child\{([^}]*)\}/g)].map((m) => m[1])
    expect(rules.at(-1)).toMatch(/flex:1 1 100%/)
  })
})
