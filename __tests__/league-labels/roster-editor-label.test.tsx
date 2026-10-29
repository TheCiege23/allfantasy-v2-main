import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { NBA_ROSTER_SLOTS, NBA_ROSTER_TEMPLATES } from '@/lib/nba-roster/NbaRosterTemplates'
import { NFL_ROSTER_SLOTS, NFL_ROSTER_TEMPLATES } from '@/lib/nfl-roster/NflRosterTemplates'

vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations: dict } = await import('@/lib/i18n/translations')
  const t = (k: string) => dict.en[k] ?? k
  return { useLanguage: () => ({ language: 'en', t, setLanguage: () => {} }), useOptionalLanguage: () => ({ language: 'en', t }) }
})
vi.mock('@/lib/draft-room/emitLeagueDraftRoomRevalidate', () => ({ emitLeagueDraftRoomRevalidate: () => {} }))

import { RosterSettingsEditor } from '@/components/league-settings/RosterSettingsEditor'

function stub(body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => body })))
}
afterEach(() => { vi.unstubAllGlobals(); cleanup() })

describe('roster settings show the matching roster label', () => {
  it("NFL redraft: the Standard chips, with the league's own bench count", async () => {
    const tpl = NFL_ROSTER_TEMPLATES.find((t) => t.key === 'redraft')!
    stub({ isCommissioner: true, slotDefs: NFL_ROSTER_SLOTS, sport: 'NFL', defaultTemplateKey: tpl.key,
      config: { templateKey: tpl.key, slots: tpl.slots, isCustom: false }, templates: NFL_ROSTER_TEMPLATES,
      unifiedConfig: { rosterMatchesTemplate: true, rosterWarnings: [] } })
    const r = render(<RosterSettingsEditor leagueId="l1" sport="NFL" />)
    const card = await r.findByTestId('roster-settings-label')
    expect(card.querySelector('[data-testid="roster-label-nfl-std"]')).not.toBeNull()
    expect(card.textContent).toContain('BN ×6')
  })

  it('NBA redraft starts C×2 / UTIL×2, which is no handoff roster — no label rather than a wrong one', async () => {
    const tpl = NBA_ROSTER_TEMPLATES[0]!
    stub({ isCommissioner: true, slotDefs: NBA_ROSTER_SLOTS, sport: 'NBA', defaultTemplateKey: tpl.key,
      config: { templateKey: tpl.key, slots: tpl.slots, isCustom: false }, templates: NBA_ROSTER_TEMPLATES,
      unifiedConfig: { rosterMatchesTemplate: true, rosterWarnings: [] } })
    const r = render(<RosterSettingsEditor leagueId="l1" sport="NBA" />)
    await r.findByText('Roster Settings')
    expect(r.queryByTestId('roster-settings-label')).toBeNull()
  })
})
