// @vitest-environment jsdom
/**
 * The recap page's Chimmy panel and share cards (components/league/SeasonRecapView.tsx): a member sees
 * the league's written recap with the names as names (never the [[marks]]), a member with nothing to
 * read sees no panel, a commissioner without AF Commissioner sees the upsell and no write button, and
 * the champion and award cards are offered for the awards the recap has.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { SeasonRecapView } from '@/components/league/SeasonRecapView'
import { sampleRecap } from './season-recap-fixture'

const recap = sampleRecap()

function stubFetch(narrativeBody: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.includes('/season-history')) return new Response(JSON.stringify({ recap, stored: true }), { status: 200 })
      if (url.includes('/season-recap-ai')) return new Response(JSON.stringify(narrativeBody), { status: 200 })
      return new Response('{}', { status: 404 })
    }),
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('SeasonRecapView — Chimmy recap and share cards', () => {
  it('a member reads the written recap, names unmarked', async () => {
    stubFetch({ narrative: { text: '[[Aces]] took the 2026 crown over [[Bears]].', source: 'ai', lang: 'en' }, isCommissioner: false, canGenerate: false, upgradePath: null })
    render(<SeasonRecapView leagueId="l1" season={2026} />)
    const panel = await screen.findByTestId('season-recap-narrative')
    expect(panel.textContent).toContain('Aces took the 2026 crown over Bears.')
    expect(panel.textContent).not.toContain('[[')
    expect(screen.queryByText('Write it again')).toBeNull()
    expect(screen.queryByText('Write the recap with Chimmy')).toBeNull()
  })

  it('a member with nothing to read sees no panel', async () => {
    stubFetch({ narrative: null, isCommissioner: false, canGenerate: false, upgradePath: null })
    render(<SeasonRecapView leagueId="l1" season={2026} />)
    await screen.findByTestId('season-recap-share-cards')
    expect(screen.queryByTestId('season-recap-narrative')).toBeNull()
  })

  it('a commissioner without AF Commissioner sees the upsell, not the button', async () => {
    stubFetch({ narrative: null, isCommissioner: true, canGenerate: false, upgradePath: '/upgrade' })
    render(<SeasonRecapView leagueId="l1" season={2026} />)
    await screen.findByText("Chimmy's written season recap comes with AF Commissioner.")
    expect(screen.getByText('See AF Commissioner').getAttribute('href')).toBe('/upgrade')
    expect(screen.queryByText('Write the recap with Chimmy')).toBeNull()
  })

  it('a commissioner with the plan can write it', async () => {
    stubFetch({ narrative: null, isCommissioner: true, canGenerate: true, upgradePath: null })
    render(<SeasonRecapView leagueId="l1" season={2026} />)
    expect(await screen.findByText('Write the recap with Chimmy')).toBeTruthy()
  })

  it('offers the champion card and the awards the recap has', async () => {
    stubFetch({ narrative: null, isCommissioner: false, canGenerate: false, upgradePath: null })
    render(<SeasonRecapView leagueId="l1" season={2026} />)
    const cards = await screen.findByTestId('season-recap-share-cards')
    await waitFor(() => expect(cards.querySelectorAll('li').length).toBeGreaterThan(1))
    const hrefs = [...cards.querySelectorAll('a')].map((a) => a.getAttribute('href'))
    expect(hrefs[0]).toBe('/api/share/season-recap-card?leagueId=l1&season=2026&card=champion&lang=en')
    expect(hrefs.some((h) => h?.includes('card=bestPickup'))).toBe(true)
    expect(hrefs.some((h) => h?.includes('card=bestTrade'))).toBe(false)
  })
})
