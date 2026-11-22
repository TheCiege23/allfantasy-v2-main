/**
 * The recap screen's two add-ons (components/league/SeasonRecapView.tsx): Chimmy's written recap — the
 * upsell for a commissioner without AF Commissioner, the write button with it, the stored text for every
 * member — and a share/download action on the champion and every award.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...(rest as Record<string, string>)}>
      {children}
    </a>
  ),
}))
const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations } = await import('@/lib/i18n/translations')
  return {
    useOptionalLanguage: () => ({
      language: lang.language,
      tInterpolate: (key: string, vars: Record<string, string | number> = {}) => {
        const table = (translations as unknown as Record<string, Record<string, string>>)[lang.language]
        const raw = table[key] ?? key
        return raw.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? ''))
      },
    }),
  }
})

import { SeasonRecapView } from '@/components/league/SeasonRecapView'
import { RECAP_LEAGUE_ID, RECAP_SEASON, recapFixture } from './recapFixture'

const recap = recapFixture()
const WRITEUP = {
  language: 'en',
  headline: 'Bears win the 2026 title',
  paragraphs: ['Bears beat Aces in the final.'],
  factsHash: 'hash-ui-1',
  generatedAt: '2027-01-10T12:00:00Z',
  generatedByUserId: 'usr-commish-701',
}

type View = { writeup: typeof WRITEUP | null; isCommissioner: boolean; entitled: boolean; upgradePath: string | null }

function serve(view: View, post?: (body: unknown) => { status: number; body: unknown }) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const r = post!(JSON.parse(String(init.body)))
      return new Response(JSON.stringify(r.body), { status: r.status })
    }
    return new Response(JSON.stringify({ recap, stored: true, writeup: view }), { status: 200 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  lang.language = 'en'
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Chimmy’s written recap on the recap screen', () => {
  it('a commissioner without AF Commissioner sees the upsell, not a write button', async () => {
    serve({ writeup: null, isCommissioner: true, entitled: false, upgradePath: '/pricing?from=season-recap' })
    render(<SeasonRecapView leagueId={RECAP_LEAGUE_ID} season={RECAP_SEASON} />)
    const upsell = await screen.findByTestId('season-recap-writeup-upsell')
    expect(upsell.textContent).toContain('A written season recap is part of AF Commissioner.')
    expect(screen.getByRole('link', { name: 'Get AF Commissioner' }).getAttribute('href')).toBe('/pricing?from=season-recap')
    expect(screen.queryByRole('button', { name: 'Write the recap with Chimmy' })).toBeNull()
  })

  it('a member with nothing written sees neither the upsell nor a button', async () => {
    serve({ writeup: null, isCommissioner: false, entitled: false, upgradePath: null })
    render(<SeasonRecapView leagueId={RECAP_LEAGUE_ID} season={RECAP_SEASON} />)
    await screen.findByText('2026 season recap')
    expect(screen.queryByTestId('season-recap-writeup-upsell')).toBeNull()
    expect(screen.queryByTestId('season-recap-writeup')).toBeNull()
  })

  it('a member reads the written recap once the commissioner has written it', async () => {
    serve({ writeup: WRITEUP, isCommissioner: false, entitled: false, upgradePath: null })
    render(<SeasonRecapView leagueId={RECAP_LEAGUE_ID} season={RECAP_SEASON} />)
    expect(await screen.findByText('Bears win the 2026 title')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Write it again' })).toBeNull()
  })

  it('a subscribed commissioner writes it, and the text appears', async () => {
    const fetchMock = serve({ writeup: null, isCommissioner: true, entitled: true, upgradePath: null }, () => ({
      status: 200,
      body: { ok: true, cached: false, writeup: WRITEUP },
    }))
    render(<SeasonRecapView leagueId={RECAP_LEAGUE_ID} season={RECAP_SEASON} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Write the recap with Chimmy' }))
    expect(await screen.findByText('Bears win the 2026 title')).toBeTruthy()
    const post = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'POST')!
    expect(JSON.parse(String((post[1] as RequestInit).body))).toEqual({ season: RECAP_SEASON, lang: 'en', regenerate: false })
  })

  it('a refused draft says so and shows no text', async () => {
    serve({ writeup: null, isCommissioner: true, entitled: true, upgradePath: null }, () => ({ status: 422, body: { error: 'fact_guard', factGuardErrors: ['x'] } }))
    render(<SeasonRecapView leagueId={RECAP_LEAGUE_ID} season={RECAP_SEASON} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Write the recap with Chimmy' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain("did not hold to the season's facts"))
  })

  it('Spanish: the upsell and the cards read Spanish, and say «reclamo», never «waiver»', async () => {
    lang.language = 'es'
    serve({ writeup: null, isCommissioner: true, entitled: false, upgradePath: null })
    const { container } = render(<SeasonRecapView leagueId={RECAP_LEAGUE_ID} season={RECAP_SEASON} />)
    const upsell = await screen.findByTestId('season-recap-writeup-upsell')
    expect(upsell.textContent).toContain('El resumen escrito de la temporada es parte de AF Commissioner.')
    expect(screen.getAllByRole('button', { name: 'Compartir tarjeta' }).length).toBeGreaterThan(0)
    expect(container.textContent?.toLowerCase()).not.toMatch(/\bwaivers?\b/)
  })
})

describe('share cards on the recap screen', () => {
  it('the champion and every award have a share and a download action', async () => {
    serve({ writeup: null, isCommissioner: false, entitled: false, upgradePath: null })
    render(<SeasonRecapView leagueId={RECAP_LEAGUE_ID} season={RECAP_SEASON} />)
    await screen.findByText('2026 season recap')
    // 12 awards in the fixture: champion, runner-up, top seed, most PF, highest week, blowout, closest,
    // best and worst trade, best pickup, most improved, toilet bowl.
    expect(screen.getAllByRole('button', { name: 'Share card' })).toHaveLength(12)
    expect(screen.getAllByRole('button', { name: 'Download' })).toHaveLength(12)
  })

  it('download fetches that award’s card from the share route', async () => {
    const fetchMock = serve({ writeup: null, isCommissioner: false, entitled: false, upgradePath: null })
    const createObjectURL = vi.fn(() => 'blob:card')
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }))
    render(<SeasonRecapView leagueId={RECAP_LEAGUE_ID} season={RECAP_SEASON} />)
    await screen.findByText('2026 season recap')
    fireEvent.click(screen.getAllByRole('button', { name: 'Download' })[0])
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Card downloaded.'))
    const urls = fetchMock.mock.calls.map(([u]) => String(u))
    expect(urls).toContain(`/api/share/rivalry-card?kind=season_recap&leagueId=${RECAP_LEAGUE_ID}&season=${RECAP_SEASON}&award=champion`)
  })
})
