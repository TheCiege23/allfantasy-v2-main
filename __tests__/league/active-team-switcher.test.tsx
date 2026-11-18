import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useLanguage: () => ({ t: (key: string) => key, language: 'en' }) }))

import { ActiveTeamSwitcher } from '@/components/league/ActiveTeamSwitcher'

const respond = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response

afterEach(() => vi.unstubAllGlobals())

describe('the team switcher', () => {
  it('shows nothing to a manager with one team', async () => {
    const fetchMock = vi.fn(async () => respond({ teams: [{ rosterId: 'r1', teamName: 'Aces' }], activeRosterId: 'r1' }))
    vi.stubGlobal('fetch', fetchMock)
    const { container } = render(<ActiveTeamSwitcher leagueId="L1" />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('lets a manager with several teams switch, and remembers it on the server', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? respond({ ok: true, activeRosterId: 'r2' })
        : respond({ teams: [{ rosterId: 'r1', teamName: 'Aces' }, { rosterId: 'r2', teamName: 'Bears' }], activeRosterId: 'r1' }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const onSwitched = vi.fn()
    render(<ActiveTeamSwitcher leagueId="L1" onSwitched={onSwitched} />)
    const select = (await screen.findByLabelText('teamSwitcher.label')) as HTMLSelectElement
    expect(select.value).toBe('r1')
    fireEvent.change(select, { target: { value: 'r2' } })
    await waitFor(() => expect(onSwitched).toHaveBeenCalledWith('r2'))
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!
    expect(post[0]).toBe('/api/leagues/L1/my-teams')
    expect(JSON.parse(String(post[1]!.body))).toEqual({ rosterId: 'r2' })
    expect(select.value).toBe('r2')
  })

  it('says so when the switch is refused, and keeps the team it had', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? respond({ error: 'That team is not yours.' }, false)
        : respond({ teams: [{ rosterId: 'r1', teamName: 'Aces' }, { rosterId: 'r2', teamName: 'Bears' }], activeRosterId: 'r1' }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const onSwitched = vi.fn()
    render(<ActiveTeamSwitcher leagueId="L1" onSwitched={onSwitched} />)
    const select = (await screen.findByLabelText('teamSwitcher.label')) as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'r2' } })
    expect(await screen.findByRole('alert')).toHaveTextContent('teamSwitcher.failed')
    expect(onSwitched).not.toHaveBeenCalled()
    expect(select.value).toBe('r1')
  })
})
