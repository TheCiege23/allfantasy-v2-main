/**
 * RosterSettingsEditor renders the league's sport — never NFL slots for an NBA league — and says
 * "not available" when the roster engine refuses a sport instead of falling back (2026-10-14).
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { NBA_ROSTER_SLOTS, NBA_ROSTER_TEMPLATES } from '@/lib/nba-roster/NbaRosterTemplates'
import { NFL_ROSTER_TEMPLATES } from '@/lib/nfl-roster/NflRosterTemplates'

vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations: dict } = await import('@/lib/i18n/translations')
  const t = (k: string) => dict.en[k] ?? k
  return { useLanguage: () => ({ language: 'en', t, setLanguage: () => {} }), useOptionalLanguage: () => ({ language: 'en', t }) }
})
vi.mock('@/lib/draft-room/emitLeagueDraftRoomRevalidate', () => ({ emitLeagueDraftRoomRevalidate: () => {} }))

import { RosterSettingsEditor } from '@/components/league-settings/RosterSettingsEditor'

function stub(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: status < 400, status, json: async () => body })))
}
const nbaTpl = NBA_ROSTER_TEMPLATES[0]!

afterEach(() => { vi.unstubAllGlobals(); cleanup() })

describe('RosterSettingsEditor is sport-correct', () => {
  it('NBA: NBA positions, IL listed apart, no football slot, no import block or totals', async () => {
    stub(200, {
      isCommissioner: true, slotDefs: NBA_ROSTER_SLOTS, sport: 'NBA', defaultTemplateKey: nbaTpl.key,
      config: { templateKey: nbaTpl.key, slots: nbaTpl.slots, isCustom: false },
      templates: NBA_ROSTER_TEMPLATES, unifiedConfig: { rosterMatchesTemplate: true, rosterWarnings: [] },
    })
    const r = render(<RosterSettingsEditor leagueId="l1" sport="NBA" />)
    await r.findByText('Roster Settings')
    for (const k of ['PG', 'SG', 'SF', 'PF', 'C', 'UTIL', 'BN', 'IL']) expect(r.queryByTestId(`roster-row-${k}`), k).not.toBeNull()
    for (const k of ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'IR']) expect(r.queryByTestId(`roster-row-${k}`), k).toBeNull()
    expect(r.container.textContent).toContain("IL (doesn't count toward draft rounds)")
    expect(r.container.textContent).toContain('Starting lineup')
    expect(r.container.textContent).not.toContain('Offense')
    expect(r.container.textContent).not.toContain('Import Mapping')
    expect(r.container.textContent).not.toContain('Starters:')
    expect(r.container.querySelector('textarea')).toBeNull()
  })

  it('an NFL roster stored on an NBA league is flagged and replaced by the NBA default', async () => {
    stub(200, {
      isCommissioner: true, slotDefs: NBA_ROSTER_SLOTS, sport: 'NBA', defaultTemplateKey: nbaTpl.key,
      config: { templateKey: 'custom', slots: NFL_ROSTER_TEMPLATES[0]!.slots, isCustom: true },
      templates: NBA_ROSTER_TEMPLATES, unifiedConfig: { rosterMatchesTemplate: false, rosterWarnings: [] },
    })
    const r = render(<RosterSettingsEditor leagueId="l1" sport="NBA" />)
    await r.findByTestId('roster-sport-mismatch')
    expect(r.queryByTestId('roster-row-QB')).toBeNull()
    expect(r.queryByTestId('roster-row-PG')).not.toBeNull()
  })

  it('a sport the roster engine refuses gets a message, not NFL slots', async () => {
    stub(400, { error: 'Roster settings not yet available for CURLING' })
    const r = render(<RosterSettingsEditor leagueId="l1" sport="CURLING" />)
    await r.findByTestId('roster-settings-unavailable')
    expect(r.container.textContent).toContain("Roster settings aren't available for CURLING yet.")
    expect(r.queryByTestId('roster-row-QB')).toBeNull()
  })
})
