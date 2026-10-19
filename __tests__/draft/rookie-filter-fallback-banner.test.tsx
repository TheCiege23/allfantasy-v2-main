/**
 * A rookies-only draft whose pool carries no rookie flags (common for MLB/NBA/NHL) keeps the full
 * pool rather than an empty board. The draft room used to show those veterans with no explanation;
 * it now shows a banner, driven by `rookieFilterState` from the pool API.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'

import { RookieFilterFallbackBanner } from '@/components/app/draft-room/RookieFilterFallbackBanner'
import { translations } from '@/lib/i18n/translations'

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8')
const tFor = (lang: 'en' | 'es') => (key: string) => translations[lang]?.[key] ?? key

describe('RookieFilterFallbackBanner', () => {
  it('renders the English copy only for the fallback state', () => {
    const { getByTestId, container } = render(
      <RookieFilterFallbackBanner rookieFilterState="fallback_no_rookie_data" t={tFor('en')} />,
    )
    const banner = getByTestId('draft-rookie-filter-fallback-banner')
    expect(banner.getAttribute('role')).toBe('status')
    expect(banner.textContent).toContain('Rookie filter unavailable for this sport')
    expect(banner.textContent).toContain('shows the full player pool')
    // Honest about validation: in this state picks are NOT refused for rookie status.
    expect(banner.textContent).toContain("Picks aren't checked for rookie status")
    expect(container.textContent).not.toContain('draftRoom.')
  })

  it('renders Spanish copy from the ES dictionary', () => {
    const { getByTestId } = render(
      <RookieFilterFallbackBanner rookieFilterState="fallback_no_rookie_data" t={tFor('es')} />,
    )
    const text = getByTestId('draft-rookie-filter-fallback-banner').textContent ?? ''
    expect(text).toContain('Filtro de rookies no disponible')
    expect(text).not.toContain('draftRoom.')
  })

  it.each(['applied', 'not_requested', undefined] as const)('renders nothing for %s', (state) => {
    const { container } = render(<RookieFilterFallbackBanner rookieFilterState={state} t={tFor('en')} />)
    expect(container.innerHTML).toBe('')
  })
})

describe('rookieFilterState is threaded from the resolver to the panel', () => {
  it('the pool route and the cache warmer both emit it', () => {
    expect(read('app/api/leagues/[leagueId]/draft/pool/route.ts')).toContain(
      'rookieFilterState: resolved.rookieFilterState',
    )
    expect(read('lib/draft-room/ensureDraftPoolReady.ts').match(/rookieFilterState: resolved\.rookieFilterState/g)).toHaveLength(2)
  })

  it('the draft room parses it off the pool response and hands it to the player pool', () => {
    const client = read('components/app/draft-room/DraftRoomPageClient.tsx')
    expect(client).toContain('rookieFilterState: parseRookieFilterState(data.rookieFilterState)')
    expect(client).toContain('rookieFilterState={draftPool?.rookieFilterState}')
  })

  it('PlayerPanel renders the banner from its prop', () => {
    const panel = read('components/app/draft-room/PlayerPanel.tsx')
    expect(panel).toMatch(/<RookieFilterFallbackBanner rookieFilterState=\{rookieFilterState\} t=\{t\} \/>/)
  })
})
