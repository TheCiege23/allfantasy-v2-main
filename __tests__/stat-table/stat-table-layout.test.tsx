/**
 * Saved column order, hidden columns and compact density for the stat tables (2026-11-28).
 *
 *   lib/table-layout/statTableLayout.ts      the rules (pure)
 *   app/api/user/table-layout                signed-in user's own layouts
 *   ColumnsMenu + useStatTableLayouts        the menu, on the real game log table
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

const auth = vi.hoisted(() => ({ userId: 'me' as string | null }))
const store = vi.hoisted(() => ({ get: vi.fn(), setLayout: vi.fn(), setDensity: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/platform/current-user', () => ({ resolvePlatformUser: vi.fn(async () => ({ appUserId: auth.userId, legacyUsername: null })) }))
vi.mock('@/lib/table-layout/statTableLayoutStore', () => ({
  getStatTableLayouts: store.get,
  setStatTableLayout: store.setLayout,
  setStatTableDensity: store.setDensity,
}))

import { applyLayout, moveColumn, readLayouts, sanitizeLayout, toggleColumn } from '@/lib/table-layout/statTableLayout'
import { GET, PUT } from '@/app/api/user/table-layout/route'
import PlayerGameLogTable from '@/components/player-game-log/PlayerGameLogTable'
import { resetStatTableLayoutsForTest } from '@/components/stat-table/useStatTableLayouts'
import { gameLogColumns } from '@/lib/player-game-log/gameLogColumns'

const cols = ['toi', 'g', 'a', 'pts', 'sog'].map((key) => ({ key }))
const keys = (xs: Array<{ key: string }>) => xs.map((c) => c.key)

describe('the layout rules', () => {
  it('reorders and hides within the table’s own columns', () => {
    expect(keys(applyLayout(cols, { order: ['pts', 'g'], hidden: ['sog'] }))).toEqual(['toi', 'pts', 'g', 'a'])
    expect(keys(applyLayout(cols, null))).toEqual(['toi', 'g', 'a', 'pts', 'sog'])
  })

  it('drops a saved column the table lost, and gives a new column its default place', () => {
    const saved = { order: ['sog', 'gone', 'toi'], hidden: [] }
    // 'g', 'a', 'pts' were not in the save (added since): they follow 'toi', their default neighbour.
    expect(keys(applyLayout(cols, saved))).toEqual(['sog', 'toi', 'g', 'a', 'pts'])
  })

  it('always leaves at least one column', () => {
    expect(keys(applyLayout(cols, { order: [], hidden: keys(cols) }))).toEqual(['toi'])
  })

  it('moves one step and toggles visibility', () => {
    const l = moveColumn(cols, { order: [], hidden: [] }, 'pts', -1)
    expect(l.order).toEqual(['toi', 'g', 'pts', 'a', 'sog'])
    expect(moveColumn(cols, l, 'toi', -1)).toBe(l)
    expect(toggleColumn(toggleColumn(l, 'g'), 'g').hidden).toEqual([])
  })

  it('stores nothing it does not recognise', () => {
    expect(sanitizeLayout({ order: ['g', 'g', '<script>', 7], hidden: 'x' })).toEqual({ order: ['g'], hidden: [] })
    expect(readLayouts({ 'bad id!': { order: ['g'] }, 'gamelog:NHL:skaters': { order: ['g'] } }, 'huge')).toEqual({
      density: 'comfortable',
      tables: { 'gamelog:NHL:skaters': { order: ['g'], hidden: [] } },
    })
  })
})

describe('/api/user/table-layout', () => {
  const put = (body: unknown) => PUT(new Request('http://x/api/user/table-layout', { method: 'PUT', body: JSON.stringify(body) }))
  beforeEach(() => {
    auth.userId = 'me'
    store.get.mockReset().mockResolvedValue({ density: 'comfortable', tables: {} })
    store.setLayout.mockReset().mockResolvedValue(undefined)
    store.setDensity.mockReset().mockResolvedValue(undefined)
  })

  it('needs a signed-in user', async () => {
    auth.userId = null
    expect((await GET()).status).toBe(401)
    expect((await put({ density: 'compact' })).status).toBe(401)
  })

  it('saves density and one table, sanitized, and refuses junk', async () => {
    expect((await put({ density: 'compact' })).status).toBe(200)
    expect(store.setDensity).toHaveBeenCalledWith('me', 'compact')
    expect((await put({ tableId: 'gamelog:NHL:skaters', layout: { order: ['g', '<x>'], hidden: [] } })).status).toBe(200)
    expect(store.setLayout).toHaveBeenCalledWith('me', 'gamelog:NHL:skaters', { order: ['g'], hidden: [] })
    expect((await put({ tableId: 'gamelog:NHL:skaters', layout: null })).status).toBe(200)
    expect(store.setLayout).toHaveBeenLastCalledWith('me', 'gamelog:NHL:skaters', null)
    expect((await put({ density: 'tiny' })).status).toBe(400)
    expect((await put({ tableId: '../../etc', layout: null })).status).toBe(400)
  })
})

describe('Columns menu on the game log', () => {
  const columns = gameLogColumns('NHL', 'skaters')
  const row = {
    gameId: 'g1:skaters', date: '2026-11-26', opponent: 'DAL', home: true, teamScore: 4, oppScore: 2, result: 'W',
    postseason: false, played: true, ratioInputs: {},
    values: { toi: 18.5, g: 1, a: 0, pts: 1, plusminus: 1, sog: 3, ppp: 0, shp: 0, hits: 2, blks: 1, pim: 0, fow: 7 },
  }
  const log = { supported: true, resolved: true, season: 2026, seasons: [2026], groups: [{ group: 'skaters', label: 'Skater', columns, rows: [row] }] }
  let puts: Array<Record<string, unknown>> = []

  function stub(layoutStatus: number, layoutBody: unknown = {}) {
    puts = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).startsWith('/api/user/table-layout')) {
          if (init?.method === 'PUT') {
            puts.push(JSON.parse(String(init.body)))
            return new Response('{}')
          }
          return new Response(JSON.stringify(layoutBody), { status: layoutStatus })
        }
        return new Response(JSON.stringify(log))
      }),
    )
  }
  const headers = () => within(screen.getByRole('table')).getAllByRole('columnheader').slice(1).map((h) => h.textContent)

  beforeEach(() => {
    resetStatTableLayoutsForTest()
    try {
      window.localStorage.clear()
    } catch {
      /* no storage */
    }
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('hides and moves columns, goes compact, and — signed out — keeps it in this browser', async () => {
    stub(401)
    render(<PlayerGameLogTable sport="NHL" playerKey={{ identityId: 'p1' }} />)
    await screen.findByRole('table')
    expect(headers().slice(0, 3)).toEqual(['TOI', 'G', 'A'])

    fireEvent.click(screen.getByTestId('columns-menu-toggle'))
    const menu = screen.getByTestId('columns-menu')
    fireEvent.click(within(menu).getByRole('checkbox', { name: /TOI/ }))
    fireEvent.click(within(menu).getByRole('button', { name: 'Move Points earlier' }))
    fireEvent.click(screen.getByTestId('columns-menu-compact'))

    expect(headers().slice(0, 3)).toEqual(['G', 'PTS', 'A'])
    expect(screen.getByTestId('af-game-log').getAttribute('data-density')).toBe('compact')
    expect(puts).toEqual([])
    const saved = JSON.parse(window.localStorage.getItem('af.statTableLayouts.v1') ?? '{}')
    expect(saved.density).toBe('compact')
    expect(saved.tables['gamelog:NHL:skaters'].hidden).toEqual(['toi'])

    // A fresh page in the same browser draws it the same way.
    cleanup()
    resetStatTableLayoutsForTest()
    render(<PlayerGameLogTable sport="NHL" playerKey={{ identityId: 'p1' }} />)
    await screen.findByRole('table')
    await waitFor(() => expect(headers().slice(0, 3)).toEqual(['G', 'PTS', 'A']))

    fireEvent.click(screen.getByTestId('columns-menu-toggle'))
    fireEvent.click(screen.getByRole('button', { name: 'Reset columns' }))
    expect(headers().slice(0, 3)).toEqual(['TOI', 'G', 'A'])
  })

  it('signed in, reads the account’s layout and saves changes to it', async () => {
    // As the menu saves it: the full order, here with shots on goal moved to the front.
    const order = ['sog', 'toi', 'g', 'a', 'pts', 'plusminus', 'ppp', 'shp', 'hits', 'blks', 'pim', 'fow']
    stub(200, { density: 'comfortable', tables: { 'gamelog:NHL:skaters': { order, hidden: [] } } })
    render(<PlayerGameLogTable sport="NHL" playerKey={{ identityId: 'p1' }} />)
    await screen.findByRole('table')
    await waitFor(() => expect(headers()[0]).toBe('SOG'))
    fireEvent.click(screen.getByTestId('columns-menu-toggle'))
    fireEvent.click(within(screen.getByTestId('columns-menu')).getByRole('checkbox', { name: /PIM/ }))
    await waitFor(() => expect(puts.length).toBe(1))
    expect(puts[0]).toMatchObject({ tableId: 'gamelog:NHL:skaters', layout: { hidden: ['pim'] } })
    expect(window.localStorage.getItem('af.statTableLayouts.v1')).toBeNull()
  })
})
