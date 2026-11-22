// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

/*
 * Defense Hub, said once (2026-11-14).
 *
 * - The headline is who leads your defense; one line says what it is built from.
 * - Snap share and "what they actually do" are ONE table, built from counts so Spanish reads Spanish:
 *   no "— first week" on every card, no "no targets-allowed column…" under every defender.
 * - Every method note is said once, folded at the bottom; the loader's English notes are not printed.
 * - The league trade board opens at its top 25, with a button for the rest; a search shows every match.
 */

const h = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useOptionalLanguage: () => ({ language: h.language, setLanguage: () => {}, t: (k: string) => k, tInterpolate: (k: string) => k }),
}))
vi.mock('next/link', () => ({ default: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }))
vi.mock('@/components/values/ValuesPageLink', () => ({ ValuesPageLink: () => <a>How we value defenders</a> }))

import { DefenseHubClient, defenseHeadline } from '@/app/idp/defense-hub/[leagueId]/DefenseHubClient'
import { BOARD_TOP } from '@/app/idp/defense-hub/[leagueId]/TradeBoardSection'
import { deriveDefenderRole } from '@/lib/idp-projections/defenderRole'
import { defenseHubMessages } from '@/lib/core-app/messages/defenseHub'
import type { DefenseHubDefender, DefenseHubPayload } from '@/lib/idp-projections/defenseHub'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  h.language = 'en'
})

const defender = (id: string, over: Partial<DefenseHubDefender> = {}): DefenseHubDefender => ({
  sleeperId: id,
  name: `Defender ${id}`,
  team: 'BAL',
  position: 'LB',
  positionGroup: 'LB',
  projection: 9.4,
  vorp: 2.1,
  positionRank: 12,
  value: 140,
  valueIsFloor: false,
  reason: null,
  lastWeek: null,
  ...over,
})

const snap = (id: string, share: number | null, games = 30) => ({
  sleeperId: id,
  name: `Defender ${id}`,
  share,
  games: share == null ? 0 : games,
  basis: share == null ? null : ('defense' as const),
  trend: null,
  reason: share == null ? 'no game on file carries both def_snp and tm_def_snp for this player' : null,
})
const role = (id: string, snaps: number, sacks: number, tackles: number | null, games = 30) => ({
  sleeperId: id,
  name: `Defender ${id}`,
  games,
  snaps,
  sacks,
  tackles,
  lines: [{ label: 'Coverage', value: null, basis: 'no targets-allowed column is ingested by any provider we read' }],
})

const PAYLOAD = (over: Partial<DefenseHubPayload> = {}): DefenseHubPayload =>
  ({
    state: 'ok',
    projectedFor: { season: 2026, week: 10 },
    coverage: { defenders: 295, projected: 291, priced: 291 },
    defenders: [defender('1', { name: 'Kaden Elliss', projection: 13.8 }), defender('2'), defender('3', { projection: null, reason: 'no projection history yet' })],
    kickers: [],
    kickerValue: null,
    snaps: [snap('1', 0.97), snap('2', 0.45), snap('3', null)],
    roles: [role('1', 2486, 9.5, 295), role('2', 855, 0, 73), role('3', 0, 0, null, 0)],
    tendencies: [],
    notes: ['No salary, contract or cap-efficiency columns: those tables have zero rows in production, so there is nothing to show for any league yet.'],
    unresolvedIds: 0,
    ...over,
  }) as DefenseHubPayload

const boardRow = (i: number) => ({
  sleeperId: `b${i}`,
  name: `Board Player ${i}`,
  team: 'DAL',
  position: 'LB',
  value: 5000 - i,
  vorp: 1,
  projectedPoints: 10,
  positionRank: i,
  valueIsFloor: false,
  ownedBy: { teamName: 'Their Team', ownerName: 'Them', isMine: false },
})
const BOARD = (n: number) => ({
  state: 'ok',
  projectedFor: { season: 2026, week: 10 },
  rows: Array.from({ length: n }, (_, i) => boardRow(i + 1)),
  kickerValue: null,
  kickers: [],
  coverage: { defenders: n, projected: n, priced: n },
  notes: [],
})

const mount = (hub: DefenseHubPayload, board = BOARD(3)) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({ ok: true, status: 200, json: async () => (String(url).includes('trade-board') ? board : hub) })),
  )
  return render(<DefenseHubClient leagueId="L1" embedded />)
}

describe('the role counts behind the table', () => {
  it('snaps, sacks and tackles come back as numbers, and a missing tackle column is null, not 0', () => {
    const r = deriveDefenderRole([
      { def_snp: 60, idp_sack: 1, idp_tkl: 7 },
      { def_snp: 50, idp_sack: 0.5, idp_tkl_solo: 3, idp_tkl_ast: 2 },
      { idp_sack: 3 },
    ])
    expect(r).toMatchObject({ games: 2, snaps: 110, sacks: 1.5, tackles: 12 })
    expect(deriveDefenderRole([{ def_snp: 40, idp_sack: 0 }]).tackles).toBeNull()
    expect(deriveDefenderRole([])).toMatchObject({ games: 0, snaps: 0, sacks: 0, tackles: null })
  })
})

describe('the headline', () => {
  it('names the defender who leads, the count and the week; with nothing projected it is just the title', () => {
    const en = defenseHubMessages.en
    expect(defenseHeadline(PAYLOAD(), en)).toBe('Kaden Elliss leads your 3 defenders: 13.8 projected for week 10')
    expect(defenseHeadline(PAYLOAD({ projectedFor: null }), en)).toBe('Kaden Elliss leads your 3 defenders: 13.8 projected')
    expect(defenseHeadline(PAYLOAD({ defenders: [defender('3', { projection: null, reason: 'x' })] }), en)).toBe('Defense Hub')
  })
})

describe('How much they play: one table, no repeated sign-offs', () => {
  it('a row per defender with the rates, and a plain line where there are no snaps', async () => {
    mount(PAYLOAD())
    await screen.findByTestId('defense-hub-play')
    const rows = screen.getAllByTestId('defense-hub-play-row').map((r) => r.textContent)
    // 2486 / 9.5 = 261.7 -> "262"; 2486 / 295 = 8.4.
    expect(rows[0]).toBe('Defender 197%30262 snaps8.4 snaps')
    expect(rows[1]).toBe('Defender 245%30none yet11.7 snaps')
    expect(rows[2]).toBe('Defender 3No snap counts on file yet')
    const page = document.body.textContent ?? ''
    expect(page).not.toContain('first week')
    expect(page).not.toContain('targets-allowed column is ingested')
    expect(page).not.toContain('def_snp')
  })

  it('a payload from before the counts existed shows dashes, never a crash or a 0', async () => {
    const old = PAYLOAD({ roles: PAYLOAD().roles.map(({ snaps: _s, sacks: _k, tackles: _t, ...r }) => r) as never })
    mount(old)
    await screen.findByTestId('defense-hub-play')
    const first = screen.getAllByTestId('defense-hub-play-row')[0]!.textContent
    expect(first).toBe('Defender 197%30——')
  })

  it('Spanish', async () => {
    h.language = 'es'
    mount(PAYLOAD())
    await screen.findByTestId('defense-hub-play')
    expect(screen.getByText('Cuánto juegan')).toBeTruthy()
    expect(screen.getByText('Una captura cada')).toBeTruthy()
    expect(screen.getAllByTestId('defense-hub-play-row')[1]!.textContent).toContain('ninguna aún')
    expect(screen.getAllByTestId('defense-hub-play-row')[2]!.textContent).toContain('Todavía no hay snaps registrados')
  })
})

describe('every method note once, folded', () => {
  it('the fold has the notes; the loader’s English notes are not printed', async () => {
    mount(PAYLOAD({ unresolvedIds: 2 }))
    const how = await screen.findByTestId('defense-hub-how')
    expect(how.tagName).toBe('DETAILS')
    expect(how.textContent).toContain('2 roster entries are stored in an id we can’t match to a player')
    expect(how.textContent).toContain('Snap counts can lag')
    expect(how.textContent).toContain('How we value defenders')
    expect(how.textContent).not.toContain('How a defense has been played')
    expect(document.body.textContent).not.toContain('zero rows in production')
  })

  it('the tendency note joins only when tendencies are shown', async () => {
    mount(
      PAYLOAD({
        tendencies: [{ team: 'BAL', tendency: { season: 2025, passRateFaced: 0.6, blitzRate: 0.3, playsFacedSeason: 1000, thirdDownRateFaced: 0.4 } as never }],
      }),
    )
    const how = await screen.findByTestId('defense-hub-how')
    expect(how.textContent).toContain('How a defense has been played')
    expect(screen.getByText('BAL defense')).toBeTruthy()
  })
})

describe('the league trade board opens at its top', () => {
  it(`shows the top ${BOARD_TOP}, then everything on a tap`, async () => {
    mount(PAYLOAD(), BOARD(40))
    await waitFor(() => expect(screen.getAllByTestId('defense-trade-board-row')).toHaveLength(BOARD_TOP))
    fireEvent.click(screen.getByRole('button', { name: 'Show all 40 defenders' }))
    expect(screen.getAllByTestId('defense-trade-board-row')).toHaveLength(40)
    fireEvent.click(screen.getByRole('button', { name: `Show the top ${BOARD_TOP}` }))
    expect(screen.getAllByTestId('defense-trade-board-row')).toHaveLength(BOARD_TOP)
  })

  it('a search shows every match, not just the top', async () => {
    mount(PAYLOAD(), BOARD(40))
    await waitFor(() => expect(screen.getAllByTestId('defense-trade-board-row')).toHaveLength(BOARD_TOP))
    fireEvent.change(screen.getByLabelText('Filter the league trade board'), { target: { value: 'Board Player 3' } })
    // Board Player 3, and 30–39: 11 matches, including ones past the top 25.
    expect(screen.getAllByTestId('defense-trade-board-row')).toHaveLength(11)
    // More matches than the top 25: every one is shown, not the first 25.
    fireEvent.change(screen.getByLabelText('Filter the league trade board'), { target: { value: 'Board Player' } })
    expect(screen.getAllByTestId('defense-trade-board-row')).toHaveLength(40)
    expect(screen.queryByTestId('defense-trade-board-more')).toBeNull()
  })

  it('no button when the board fits', async () => {
    mount(PAYLOAD(), BOARD(10))
    await waitFor(() => expect(screen.getAllByTestId('defense-trade-board-row')).toHaveLength(10))
    expect(screen.queryByTestId('defense-trade-board-more')).toBeNull()
  })

  it('Spanish, and every key has its pair', async () => {
    h.language = 'es'
    mount(PAYLOAD(), BOARD(40))
    // The heading shows while the board loads, so wait for the rows themselves.
    await waitFor(() => expect(screen.getAllByTestId('defense-trade-board-row')).toHaveLength(BOARD_TOP))
    expect(screen.getByText('Tabla de intercambios de la liga')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Ver los 40 defensores' })).toBeTruthy()
    expect(screen.getByText('Ocultar mis jugadores')).toBeTruthy()
    expect(Object.keys(defenseHubMessages.es!).sort()).toEqual(Object.keys(defenseHubMessages.en).sort())
    for (const v of Object.values(defenseHubMessages.es!)) if (typeof v === 'string') expect(v.toLowerCase()).not.toContain('waiver')
  })
})
