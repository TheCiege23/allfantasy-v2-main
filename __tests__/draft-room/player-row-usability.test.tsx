import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { PlayerDisplayModel } from '@/lib/draft-sports-models/types'

vi.mock('@/components/app/draft-room/PlayerAvatar', () => ({ PlayerAvatar: () => <span /> }))
vi.mock('@/components/app/draft-room/LazyDraftImage', () => ({ LazyDraftImage: () => <span /> }))
import { DraftPlayerCard } from '@/components/app/draft-room/DraftPlayerCard'

function display(sport: PlayerDisplayModel['sport'], injuryStatus: string | null = null): PlayerDisplayModel {
  return {
    playerId: 'test-player', displayName: 'Test Athlete', sport,
    assets: { headshotUrl: null, teamLogoUrl: null }, team: null,
    stats: { adp: 44, primaryStatLabel: 'ADP', primaryStatValue: 44 },
    metadata: { position: 'C', sport, teamAbbreviation: 'BOS', byeWeek: null, injuryStatus },
  }
}

describe('readable player rows keep data labels honest', () => {
  it('shows the caller-selected AI ADP instead of the display model market ADP', () => {
    const html = renderToStaticMarkup(<DraftPlayerCard display={display('NBA')} name="Test Athlete" position="C"
      draftSport="NBA" adp={5.2} adpMetricLabel="AI ADP" testId="athlete" />)
    expect(html).toContain('athlete-adp">5.2</span>')
    expect(html).not.toContain('>44</span>')
  })
  it('does not substitute market ADP for an unavailable selected metric', () => {
    const html = renderToStaticMarkup(<DraftPlayerCard display={display('NBA')} name="Test Athlete" position="C"
      draftSport="NBA" adp={null} adpMetricLabel="AI ADP" testId="athlete" />)
    expect(html).not.toContain('athlete-adp')
  })
  it('does not substitute market ADP when an AI ADP value was omitted', () => {
    const html = renderToStaticMarkup(<DraftPlayerCard display={display('NBA')} name="Test Athlete" position="C"
      draftSport="NBA" adpMetricLabel="AI ADP" testId="athlete" />)
    expect(html).not.toContain('athlete-adp')
  })
  it('does not label a fantasy-points primary stat as market ADP', () => {
    const model = { ...display('NBA'), stats: { primaryStatLabel: 'FPPG', primaryStatValue: 31.7 } }
    const html = renderToStaticMarkup(<DraftPlayerCard display={model} name="Test Athlete" position="C"
      draftSport="NBA" testId="athlete" />)
    expect(html).not.toContain('athlete-adp')
  })
  it('keeps an explicitly unavailable market value unavailable', () => {
    const html = renderToStaticMarkup(<DraftPlayerCard display={display('NBA')} name="Test Athlete" position="C"
      draftSport="NBA" adp={null} testId="athlete" />)
    expect(html).not.toContain('athlete-adp')
  })
  it.each(['NFL', 'NBA', 'NHL', 'MLB'] as const)('omits generic unavailable status and stats in %s', sport => {
    const html = renderToStaticMarkup(<DraftPlayerCard display={{ ...display(sport, 'UNKNOWN'), stats: {} }}
      name="Test Athlete" position="C" draftSport={sport} testId="athlete" />)
    expect(html).not.toContain('UNKNOWN')
    expect(html).not.toContain('No stats available')
    if (sport !== 'NFL') expect(html).not.toContain('Bye')
  })
  it('preserves an actual injury designation', () => {
    const html = renderToStaticMarkup(<DraftPlayerCard display={display('NHL', 'OUT')} name="Test Athlete"
      position="C" draftSport="NHL" testId="athlete" />)
    expect(html).toContain('athlete-injury-status">OUT</span>')
  })
})
