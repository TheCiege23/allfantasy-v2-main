import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BracketChallenge, SAVE_DEBOUNCE_MS } from '@/components/core-app/screens/BracketChallenge'
import { SPORT_SHELLS, firstRoundPairs, toClientShell, type SportKey } from '@/lib/brackets/sportShell'
import type { BracketChallengeData, BracketSide } from '@/lib/core-app/bracketChallenge'

/*
 * `next/link` reads the App Router context and throws when it is absent, which
 * says nothing about this screen. Stubbed to the anchor it renders in practice.
 */
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: lang.language }) }))

/**
 * /core/bracket saves its champion and series-length picks to the account
 * (/api/core/bracket-picks) — but only when that route says it can. Signed out,
 * before the `core_bracket_picks` migration is applied, or on a failed read, the
 * picks stay in component state and a reload clears them.
 *
 * The screen once said "Nothing you pick is lost when the field locks" while
 * nothing was saved anywhere. These tests pin that the COPY FOLLOWS THE STORAGE,
 * in both directions: the "not saved" note and an empty remount whenever saving
 * is off; the "saved to your account" note and a remount that brings the picks
 * back whenever it is on. Wire one without the other and a test here goes red.
 */

function side(sport: SportKey, label: string): BracketSide {
  const shell = toClientShell(SPORT_SHELLS[sport])
  const perSide = shell.teamCount / 2
  return {
    label,
    slots: Array.from({ length: perSide }, (_, i) => ({
      seed: i + 1,
      team: null,
      bye: shell.byeSeeds.includes(i + 1),
    })),
    pairs: firstRoundPairs(shell),
  }
}

function data(seedsPending = true, sport: SportKey = 'mlb'): BracketChallengeData {
  return {
    shell: toClientShell(SPORT_SHELLS[sport]),
    sports: [{ key: 'mlb', label: 'MLB', available: true }],
    sides: [side(sport, 'American League'), side(sport, 'National League')],
    pool: [
      { id: 't-1', name: 'Club One', shortName: 'ONE', logo: null },
      { id: 't-2', name: 'Club Two', shortName: 'TWO', logo: null },
    ],
    seedsPending,
  }
}

/* ── A fake /api/core/bracket-picks: one stored row, the same contract as the route. ── */

type GetMode = 'ok' | 'unauthorized' | 'unavailable' | 'error'
type Stored = { championTeamId: string | null; finalLength: number | null; updatedAt: string } | null

const api = {
  get: 'ok' as GetMode,
  stored: null as Stored,
  failPuts: 0,
  puts: [] as Array<Record<string, unknown>>,
}

function reply(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

const fetchMock = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
  if (!url.startsWith('/api/core/bracket-picks')) throw new Error(`unexpected fetch ${url}`)
  if ((init?.method ?? 'GET') === 'GET') {
    if (api.get === 'unauthorized') return reply(401, { error: 'Unauthorized' })
    if (api.get === 'unavailable') return reply(200, { status: 'unavailable' })
    if (api.get === 'error') return reply(503, { error: 'Your saved picks could not be read.' })
    return reply(200, { status: 'ok', sport: 'mlb', seasonYear: 2026, pick: api.stored })
  }
  const body = JSON.parse(init!.body!) as Record<string, unknown>
  api.puts.push(body)
  if (api.failPuts > 0) {
    api.failPuts -= 1
    return reply(503, { error: 'Your picks could not be saved.' })
  }
  api.stored = {
    championTeamId: body.championTeamId as string | null,
    finalLength: body.finalLength as number | null,
    updatedAt: '2026-10-06T12:00:00.000Z',
  }
  return reply(200, { status: 'ok', sport: 'mlb', seasonYear: 2026, pick: api.stored })
})

beforeEach(() => {
  lang.language = 'en'
  api.get = 'ok'
  api.stored = null
  api.failPuts = 0
  api.puts = []
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const SAVE_WAIT = { timeout: (SAVE_DEBOUNCE_MS || 600) + 2000 }

function pickClubTwoInSix() {
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 't-2' } })
  fireEvent.click(screen.getByRole('button', { name: '6' }))
}

describe('BracketChallenge — when saving is OFF the picks are a preview, and the screen says so', () => {
  it.each<[GetMode, boolean]>([
    ['unauthorized', true],
    ['unauthorized', false],
    ['unavailable', true],
    ['error', false],
  ])('never promises persistence (route: %s, seedsPending=%s)', async (mode, seedsPending) => {
    api.get = mode
    const { container } = render(<BracketChallenge data={data(seedsPending)} />)
    const note = await screen.findByTestId('af-bk-unsaved')
    const text = container.textContent ?? ''

    expect(text).not.toMatch(/nothing you pick is lost/i)
    expect(text).not.toMatch(/\b(are|is) saved\b/i)
    expect(screen.queryByTestId('af-bk-saved')).toBeNull()

    expect(note.textContent).toMatch(/not saved/i)
    expect(note.textContent).toMatch(/reload/i)
    // Points at where picks DO count: a pool, entered from the Brackets hub.
    expect(note.querySelector('a')?.getAttribute('href')).toBe('/brackets')
  })

  it.each<GetMode>(['unauthorized', 'unavailable'])(
    'a remount starts empty and nothing is sent (route: %s)',
    async (mode) => {
      api.get = mode
      const first = render(<BracketChallenge data={data()} />)
      await screen.findByTestId('af-bk-unsaved')
      pickClubTwoInSix()
      expect(screen.getByRole('combobox')).toHaveProperty('value', 't-2')
      expect(screen.getByRole('button', { name: '6' }).getAttribute('aria-pressed')).toBe('true')
      await new Promise((r) => setTimeout(r, (SAVE_DEBOUNCE_MS || 600) + 100))
      first.unmount()

      render(<BracketChallenge data={data()} />)
      await screen.findByTestId('af-bk-unsaved')
      expect(screen.getByRole('combobox')).toHaveProperty('value', '')
      expect(screen.getByText('Pick your champion')).toBeTruthy()
      expect(screen.getByRole('button', { name: '6' }).getAttribute('aria-pressed')).toBe('false')
      expect(api.puts).toEqual([])
    },
  )

  it('a sport whose bracket is not built never asks the route at all', async () => {
    render(<BracketChallenge data={data(true, 'nba')} />)
    expect(screen.getByTestId('af-bk-unsaved').textContent).toMatch(/not saved/i)
    await new Promise((r) => setTimeout(r, 50))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('BracketChallenge — when saving is ON the picks survive a remount, and the screen says so', () => {
  it('saves a change (debounced, one PUT) and a remount brings it back', async () => {
    const first = render(<BracketChallenge data={data()} />)
    const note = await screen.findByTestId('af-bk-saved')
    expect(note.textContent).toMatch(/saved to your account/i)
    expect(note.textContent).toMatch(/not a pool entry/i)
    expect(note.querySelector('a')?.getAttribute('href')).toBe('/brackets')
    expect(screen.queryByTestId('af-bk-unsaved')).toBeNull()
    expect(screen.getByRole('status').textContent).toMatch(/nothing picked yet/i)

    pickClubTwoInSix()
    expect(screen.getByRole('status').textContent).toMatch(/saving/i)
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Saved'), SAVE_WAIT)
    // Two taps inside the debounce window are ONE write, carrying both picks.
    expect(api.puts).toEqual([{ sport: 'mlb', championTeamId: 't-2', finalLength: 6 }])
    first.unmount()

    render(<BracketChallenge data={data()} />)
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveProperty('value', 't-2'))
    expect(screen.getByRole('button', { name: '6' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('Club Two', { selector: '.af-bk-champ-name' })).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe('Saved')
  })

  it('a pick still inside the debounce window is flushed when the screen unmounts', async () => {
    const first = render(<BracketChallenge data={data()} />)
    await screen.findByTestId('af-bk-saved')
    fireEvent.click(screen.getByRole('button', { name: '5' }))
    first.unmount()
    await waitFor(() => expect(api.puts).toEqual([{ sport: 'mlb', championTeamId: null, finalLength: 5 }]))
  })

  it('a failed save says so, and "Try again" saves', async () => {
    api.failPuts = 1
    render(<BracketChallenge data={data()} />)
    await screen.findByTestId('af-bk-saved')
    pickClubTwoInSix()
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/not saved/i), SAVE_WAIT)
    expect(api.stored).toBeNull()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    })
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Saved'))
    expect(api.stored).toMatchObject({ championTeamId: 't-2', finalLength: 6 })
  })

  it('a saved champion the picker cannot offer right now is kept when only the length changes', async () => {
    api.stored = { championTeamId: 'off-list', finalLength: 4, updatedAt: '2026-10-06T12:00:00.000Z' }
    render(<BracketChallenge data={data()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '4' }).getAttribute('aria-pressed')).toBe('true'))
    fireEvent.click(screen.getByRole('button', { name: '7' }))
    await waitFor(() => expect(api.puts).toHaveLength(1), SAVE_WAIT)
    expect(api.puts[0]).toEqual({ sport: 'mlb', championTeamId: 'off-list', finalLength: 7 })
  })
})

describe('BracketChallenge — Spanish', () => {
  it('the preview note, in Spanish', async () => {
    lang.language = 'es'
    api.get = 'unavailable'
    render(<BracketChallenge data={data()} />)
    const note = await screen.findByTestId('af-bk-unsaved')
    expect(note.textContent).toBe(
      'Estas selecciones son una vista previa y no se guardan: al recargar se borran. Para hacer selecciones que cuenten, únete a un pool o crea uno.',
    )
    expect(screen.getByText('Elige a tu campeón')).toBeTruthy()
  })

  it('the saved note and status, in Spanish', async () => {
    lang.language = 'es'
    render(<BracketChallenge data={data()} />)
    const note = await screen.findByTestId('af-bk-saved')
    expect(note.textContent).toMatch(/^Tus selecciones se guardan en tu cuenta/)
    expect(screen.getByRole('status').textContent).toBe('Aún no has elegido nada. Tus selecciones se guardan al hacerlas.')
    pickClubTwoInSix()
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Guardado'), SAVE_WAIT)
  })
})
