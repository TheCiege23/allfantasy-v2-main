/**
 * League home's Chopping block card for an imported Guilly league (2026-11-09). Built from the Guilly
 * tab's own view (buildImportedGuillyView), so these tests drive that real builder with provider rows.
 */
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildImportedGuillyView } from '@/lib/guillotine/importedGuillyView'
import { chopCardSummary } from '@/lib/guillotine/importedGuillyChopCard'
import { ImportedGuillyChopCard } from '@/components/league/ImportedGuillyChopCard'

const teams = ['A', 'B', 'C', 'D', 'E'].map((name, i) => ({ rosterId: String(i + 1), name }))
const row = (week: number, rosterId: string, pointsFor: number) => ({ week, rosterId, pointsFor, matchupId: null })

/** Week 1: E holds the low score and is chopped. Week 2, under way: D is low, C within 10 of it. */
const view = buildImportedGuillyView({
  teams,
  rows: [
    row(1, '1', 110), row(1, '2', 100), row(1, '3', 95), row(1, '4', 90), row(1, '5', 60),
    row(2, '1', 120), row(2, '2', 104), row(2, '3', 86), row(2, '4', 80),
  ],
})

describe('chopCardSummary', () => {
  it('counts the field: alive of everyone the league started with', () => {
    const s = chopCardSummary(view, '1')
    expect(s.week).toBe(2)
    expect(s.teamsAlive).toBe(4)
    expect(s.teamsTotal).toBe(5)
    expect(s.lowest).toEqual({ names: ['D'], points: 80 })
  })

  it('places the viewer: safe, in danger, on the line', () => {
    expect(chopCardSummary(view, '1')).toMatchObject({ state: 'safe', yourPoints: 120 })
    expect(chopCardSummary(view, '3')).toMatchObject({ state: 'danger', yourPoints: 86 })
    expect(chopCardSummary(view, '4')).toMatchObject({ state: 'chop_zone', yourPoints: 80 })
  })

  it('says chopped, and when, for a team that is out — never a score', () => {
    expect(chopCardSummary(view, '5')).toMatchObject({ state: 'chopped', choppedWeek: 1, yourPoints: null })
  })

  it('names every team tied on the line', () => {
    const tied = buildImportedGuillyView({ teams: teams.slice(0, 3), rows: [row(1, '1', 90), row(1, '2', 70), row(1, '3', 70)] })
    expect(chopCardSummary(tied, '1').lowest).toEqual({ names: ['B', 'C'], points: 70 })
  })

  it('draws no line before anyone has scored', () => {
    const fresh = buildImportedGuillyView({ teams, rows: [] })
    expect(chopCardSummary(fresh, '1')).toMatchObject({ state: 'not_started', lowest: null, yourPoints: null, teamsAlive: 5, teamsTotal: 5 })
  })

  it('does not guess a team for a viewer it cannot find', () => {
    expect(chopCardSummary(view, null)).toMatchObject({ state: 'unknown', yourPoints: null })
    expect(chopCardSummary(view, '99')).toMatchObject({ state: 'unknown', yourPoints: null })
  })
})

describe('ImportedGuillyChopCard', () => {
  afterEach(() => vi.unstubAllGlobals())
  const respond = (body: unknown, ok = true) =>
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok, json: async () => body })))

  it('shows where the viewer stands, from the Guilly endpoint', async () => {
    respond({ platform: 'sleeper', view, check: { status: 'ok', attention: 0, format: 'confirmed' }, lastReadAt: null })
    render(<ImportedGuillyChopCard leagueId="lg 1" platform="sleeper" yourRosterId="3" onOpenGuilly={() => {}} />)
    const card = await screen.findByTestId('imported-guilly-chop-card')
    expect(card.getAttribute('data-state')).toBe('danger')
    expect(screen.getByText('You’re close to the chop line')).toBeTruthy()
    expect(screen.getByTestId('imported-guilly-chop-card-yours').textContent).toBe('86.00')
    expect(screen.getByTestId('imported-guilly-chop-card-lowest').textContent).toBe('D · 80.00')
    expect(screen.getByTestId('imported-guilly-chop-card-alive').textContent).toBe('4 of 5')
    expect(card.textContent).toContain('Sleeper runs the chops')
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/leagues/lg%201/guillotine/imported')
  })

  it('says so when the reliability check doubts the picture', async () => {
    respond({ platform: 'sleeper', view, check: { status: 'attention', attention: 2, format: 'confirmed' }, lastReadAt: null })
    render(<ImportedGuillyChopCard leagueId="lg" platform="sleeper" yourRosterId="1" onOpenGuilly={() => {}} />)
    expect((await screen.findByTestId('imported-guilly-chop-card')).textContent).toContain('may be out of step with Sleeper')
  })

  it('renders nothing when the read fails — no error box on League home', async () => {
    respond({ error: 'Not an imported Guilly league' }, false)
    const { container } = render(<ImportedGuillyChopCard leagueId="lg" platform="sleeper" yourRosterId="1" onOpenGuilly={() => {}} />)
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled())
    expect(container.innerHTML).toBe('')
  })
})
