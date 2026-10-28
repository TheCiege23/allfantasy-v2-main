/** Taxi stealing — the Waivers card and the Roster settings panel, in both languages. */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))

vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations } = await import('@/lib/i18n/translations')
  const t = (k: string) => translations[lang.language][k] ?? translations.en[k] ?? k
  return {
    useOptionalLanguage: () => ({
      language: lang.language,
      t,
      tInterpolate: (k: string, vars: Record<string, string | number>) => t(k).replace(/\{\{(\w+)\}\}/g, (_: string, v: string) => String(vars[v] ?? '')),
    }),
  }
})

import { TaxiStealCard } from '@/components/core-app/TaxiStealCard'
import { TaxiStealingPanel } from '@/components/league-settings/TaxiStealingPanel'

const FUTURE = new Date(Date.now() + 86_400_000).toISOString()
const view = (over: Record<string, unknown> = {}) => ({
  supported: true,
  rule: { enabled: true, protectHours: 48, claimsPerSeason: 1 },
  active: true,
  isCommissioner: false,
  canEdit: false,
  myTeam: { rosterId: 'rB', teamName: 'Bravo', claimsLeft: 1 },
  available: [
    { playerId: 'p1', name: 'Rookie One', position: 'WR', team: 'KC', fromRosterId: 'rA', ownerTeam: 'Alpha', claimed: false },
    { playerId: 'p3', name: 'Rookie Three', position: 'TE', team: 'SF', fromRosterId: 'rC', ownerTeam: 'Charlie', claimed: true },
  ],
  againstMe: [],
  mine: [],
  open: [],
  recent: [],
  ...over,
})

const stub = (body: unknown, post: { ok: boolean; body: unknown } = { ok: true, body: { ok: true } }) => {
  const f = vi.fn(async (_u: string, init?: { method?: string }) =>
    init?.method === 'POST' ? { ok: post.ok, json: async () => post.body } : { ok: true, json: async () => body },
  )
  vi.stubGlobal('fetch', f)
  return f
}
const posted = (f: ReturnType<typeof stub>) => f.mock.calls.filter((c) => c[1]?.method === 'POST').map((c) => JSON.parse(String((c[1] as { body: string }).body)))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  lang.language = 'en'
})

describe('the Waivers card', () => {
  it('claims another team’s taxi player after a confirm; an already-claimed one has no button', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const f = stub(view())
    render(<TaxiStealCard leagueId="L" />)
    const buttons = await screen.findAllByTestId('taxi-steals-claim')
    expect(buttons).toHaveLength(1)
    fireEvent.click(buttons[0]!)
    await waitFor(() => expect(posted(f)).toEqual([{ action: 'claim', playerId: 'p1' }]))
  })

  it('cannot claim once the season’s claims are used', async () => {
    stub(view({ myTeam: { rosterId: 'rB', teamName: 'Bravo', claimsLeft: 0 } }))
    render(<TaxiStealCard leagueId="L" />)
    expect(((await screen.findByTestId('taxi-steals-claim')) as HTMLButtonElement).disabled).toBe(true)
  })

  it('the owner protects, or lets go after a confirm', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const f = stub(view({ againstMe: [{ claimId: 'c1', player: 'Rookie One', claimer: 'Charlie', deadline: FUTURE }] }))
    render(<TaxiStealCard leagueId="L" />)
    fireEvent.click(await screen.findByTestId('taxi-steals-protect'))
    await waitFor(() => expect(posted(f)).toEqual([{ action: 'protect', claimId: 'c1' }]))
    fireEvent.click(screen.getByTestId('taxi-steals-release'))
    await waitFor(() => expect(posted(f)).toEqual([{ action: 'protect', claimId: 'c1' }, { action: 'release', claimId: 'c1' }]))
  })

  it('shows the route’s refusal in the viewer’s language', async () => {
    lang.language = 'es'
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    stub(view(), { ok: false, body: { error: 'Another team has already claimed that player.', code: 'ALREADY_CLAIMED' } })
    render(<TaxiStealCard leagueId="L" />)
    fireEvent.click(await screen.findByTestId('taxi-steals-claim'))
    expect(await screen.findByText('Otro equipo ya reclamó a ese jugador.')).toBeTruthy()
  })

  it('renders nothing while the rule is not running and the viewer has no open claim', async () => {
    stub(view({ active: false }))
    const { container } = render(<TaxiStealCard leagueId="L" />)
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    expect(container.innerHTML).toBe('')
  })
})

describe('the Roster settings panel', () => {
  it('a commissioner on the plan switches it on with a window and a claim limit', async () => {
    const f = stub(view({ rule: { enabled: false, protectHours: 48, claimsPerSeason: 1 }, active: false, isCommissioner: true, canEdit: true }))
    render(<TaxiStealingPanel leagueId="L" />)
    fireEvent.click(await screen.findByRole('switch'))
    fireEvent.change(screen.getByTestId('taxi-stealing-hours'), { target: { value: '72' } })
    fireEvent.change(screen.getByTestId('taxi-stealing-per'), { target: { value: '0' } })
    fireEvent.click(screen.getByTestId('taxi-stealing-save'))
    await waitFor(() => expect(posted(f)).toEqual([{ action: 'rule', rule: { enabled: true, protectHours: 72, claimsPerSeason: 0 } }]))
  })

  it('without the plan a commissioner sees the upgrade link and cannot switch it on', async () => {
    stub(view({ rule: { enabled: false, protectHours: 48, claimsPerSeason: 1 }, active: false, isCommissioner: true, canEdit: false }))
    render(<TaxiStealingPanel leagueId="L" />)
    expect(await screen.findByTestId('taxi-stealing-upgrade')).toBeTruthy()
    expect((screen.getByRole('switch') as HTMLButtonElement).disabled).toBe(true)
  })

  it('a member sees it read-only, with no save button', async () => {
    stub(view())
    render(<TaxiStealingPanel leagueId="L" />)
    expect((await screen.findByTestId('taxi-stealing-status')).textContent).toBe('On')
    expect(screen.queryByTestId('taxi-stealing-save')).toBeNull()
  })
})
