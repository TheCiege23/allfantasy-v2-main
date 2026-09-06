import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PlayerSearchBox } from '@/components/core-app/player-finder/PlayerSearchBox'

/*
 * Enter on a highlighted row clicks that row's link. The click is caught at
 * the document so the test can read the href and stop jsdom trying to
 * navigate; `push` records what was opened.
 */
const push = vi.fn()
function onDocClick(e: Event) {
  const a = (e.target as HTMLElement | null)?.closest('a')
  if (a) {
    push(a.getAttribute('href'))
    e.preventDefault()
  }
}
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...(rest as Record<string, string>)}>
      {children}
    </a>
  ),
}))

/*
 * Suggestions as you type, on top of a form that still works without them.
 * The catalog endpoint is mocked; the debounce is driven with fake timers.
 */

const KINCAID = { externalId: 'ri-1', sleeperId: '10236', name: 'Dalton Kincaid', sport: 'NFL', position: 'TE', team: 'BUF', imageUrl: null }
// The same athlete from a second source, spelled the way TheSportsDB spells him — and the only row with a headshot.
const KINCAID_DUPE = { ...KINCAID, externalId: 'tsdb_34249066', sleeperId: null, position: 'Tight End', team: 'Buffalo Bills', imageUrl: 'https://img/kincaid.png' }
const KING = {
  externalId: 'ri-2',
  sleeperId: '77',
  name: 'Kingsley Suamataia',
  sport: 'NFL',
  position: 'OT',
  team: 'KC',
  imageUrl: null,
  presence: { yours: [], owned: [{ leagueName: 'Gridiron Gang', ownerName: 'tashaR' }], free: ['Dynasty Dragons'], unchecked: 0 },
}

const fetchMock = vi.fn()

function ok(body: unknown) {
  return { ok: true, status: 200, headers: new Headers(), json: async () => body }
}

async function typeAndSettle(text: string) {
  fireEvent.change(screen.getByRole('combobox', { name: 'Search any player' }), { target: { value: text } })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(350)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  fetchMock.mockReset()
  push.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  document.addEventListener('click', onDocClick)
})
afterEach(() => {
  document.removeEventListener('click', onDocClick)
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('PlayerSearchBox', () => {
  it('keeps the GET form: the query input, the held league, and the Search button', () => {
    const { container } = render(<PlayerSearchBox query="Dalton Kincaid" selectedLeagueId="L-gang" signedIn />)
    const form = container.querySelector('form') as HTMLFormElement
    expect(form).toHaveAttribute('action', '/core/players')
    expect(form).toHaveAttribute('method', 'get')
    expect(container.querySelector('input[name="league"]')).toHaveAttribute('value', 'L-gang')
    expect(screen.getByRole('combobox', { name: 'Search any player' })).toHaveValue('Dalton Kincaid')
    expect(screen.getByRole('button', { name: 'Search' })).toHaveAttribute('type', 'submit')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('asks the catalog after a pause, folds duplicate source rows, and links each hit the way the match list does', async () => {
    // The source rows arrive with the non-Sleeper one first; the Sleeper-keyed row still wins.
    fetchMock.mockResolvedValueOnce(ok([KINCAID_DUPE, KINCAID, KING]))
    render(<PlayerSearchBox query="" selectedLeagueId="L-gang" signedIn />)
    await typeAndSettle('kin')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/core/players/suggest?q=kin&limit=8')
    const list = screen.getByRole('listbox', { name: 'Suggestions' })
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(2)
    expect(list).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /Dalton Kincaid.*TE · BUF/ })
    expect(link).toHaveAttribute('href', '/core/players?q=Dalton%20Kincaid&player=NFL%3Ari-1&league=L-gang')
    expect(screen.queryByText('Tight End', { exact: false })).not.toBeInTheDocument()
    // The headshot is borrowed from the folded row; the crest rides along.
    expect(link.querySelector('img.af-pf-avatar')).toHaveAttribute('src', 'https://img/kincaid.png')
    expect(link.querySelector('img.af-pf-team-logo')).toHaveAttribute('src', 'https://a.espncdn.com/i/teamlogos/nfl/500/buf.png')
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'true')
    // The chip says where he is in your leagues; a row without presence has none.
    expect(screen.getByText('@tashaR has him in Gridiron Gang')).toHaveAttribute('data-tone', 'warn')
    expect(link.querySelector('.af-pf-suggest-chip')).toBeNull()
  })

  it('does not ask for one character, and reuses a cached answer instead of asking twice', async () => {
    fetchMock.mockResolvedValue(ok([KINCAID]))
    render(<PlayerSearchBox query="" selectedLeagueId={null} signedIn />)
    await typeAndSettle('k')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()

    await typeAndSettle('kin')
    await typeAndSettle('kinc')
    await typeAndSettle('kin')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('link', { name: /Dalton Kincaid/ })).toHaveAttribute('href', '/core/players?q=Dalton%20Kincaid&player=NFL%3Ari-1')
  })

  it('arrows through the list and Enter opens the highlighted player', async () => {
    fetchMock.mockResolvedValueOnce(ok([KINCAID, KING]))
    render(<PlayerSearchBox query="" selectedLeagueId={null} signedIn />)
    await typeAndSettle('kin')
    const input = screen.getByRole('combobox')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true')
    expect(input).toHaveAttribute('aria-activedescendant', 'af-pf-suggest-1')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(push).toHaveBeenCalledWith('/core/players?q=Kingsley%20Suamataia&player=NFL%3Ari-2')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('Enter with nothing highlighted leaves the form to submit, and Escape closes the list', async () => {
    fetchMock.mockResolvedValueOnce(ok([KINCAID]))
    render(<PlayerSearchBox query="" selectedLeagueId={null} signedIn />)
    await typeAndSettle('kin')
    const input = screen.getByRole('combobox')
    const enter = fireEvent.keyDown(input, { key: 'Enter' })
    expect(enter).toBe(true) // not prevented — the browser submits the GET form
    expect(push).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  /*
   * ⚠ The page arrives with its own query in the box. That is not a request
   * for suggestions: fetching on mount opened the list over the match card on
   * every load (seen in the compare renders, 2026-09-06). Only typing asks.
   */
  it('does not fetch or open the list for the query the page loaded with — only typing does', async () => {
    fetchMock.mockResolvedValue(ok([KINCAID]))
    render(<PlayerSearchBox query="Dalton Kincaid" selectedLeagueId={null} signedIn />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()

    await typeAndSettle('Dalton Kincai')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('listbox')).toBeInTheDocument()
  })

  /* The compare variant: a second name beside the one already open. */
  it('in compare mode, links every hit to ?player=<open>&vs=<hit>, starts empty, and never submits', async () => {
    fetchMock.mockResolvedValueOnce(ok([KING, KINCAID]))
    const { container } = render(<PlayerSearchBox query="Dalton Kincaid" selectedLeagueId="L-gang" signedIn variant="compare" compareWith="NFL:ri-1" />)
    const input = screen.getByRole('combobox', { name: 'Compare with another player' })
    expect(input).toHaveValue('')
    expect(screen.queryByRole('button', { name: 'Search' })).toBeNull()
    expect(screen.queryByText(/Searches every platform/)).toBeNull()

    fireEvent.change(input, { target: { value: 'kin' } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350)
    })
    const list = screen.getByRole('listbox', { name: 'Players to compare' })
    expect(list).toHaveAttribute('id', 'af-pf-suggest-vs')
    const links = screen.getAllByRole('option').map((o) => o.querySelector('a')?.getAttribute('href'))
    expect(links).toEqual([
      '/core/players?q=Dalton%20Kincaid&player=NFL%3Ari-1&vs=NFL%3Ari-2&league=L-gang',
      '/core/players?q=Dalton%20Kincaid&player=NFL%3Ari-1&vs=NFL%3Ari-1&league=L-gang',
    ])

    // Enter with nothing highlighted is swallowed: there is no page for "the second player alone".
    const form = container.querySelector('form') as HTMLFormElement
    const submitted = fireEvent.submit(form)
    expect(submitted).toBe(false)
    expect(push).not.toHaveBeenCalled()

    // Enter on a highlighted row opens that row's compare link.
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input).toHaveAttribute('aria-activedescendant', 'af-pf-suggest-vs-0')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(push).toHaveBeenCalledWith('/core/players?q=Dalton%20Kincaid&player=NFL%3Ari-1&vs=NFL%3Ari-2&league=L-gang')
  })

  /* ⚠ A 429 IS EXPECTED UNDER FAST TYPING. The list stays closed; the form keeps working. */
  it('goes quiet on a rate limit and does not retry until the cooldown passes', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429, headers: new Headers({ 'Retry-After': '30' }), json: async () => ({}) })
    render(<PlayerSearchBox query="" selectedLeagueId={null} signedIn />)
    await typeAndSettle('kin')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    await typeAndSettle('kinc')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument()
  })
})
