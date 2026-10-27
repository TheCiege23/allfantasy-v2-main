import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The live draft room's Chimmy wiring. DraftHelperPanel was imported but never rendered
 * (`helperPanel={undefined}`), which hid the phone's AI tab and left three "Ask Chimmy" buttons
 * calling setMobileTab('helper') into nothing. Guarded at source level because the room is too
 * large to render in a unit test.
 */

const src = readFileSync(join(process.cwd(), 'components/app/draft-room/DraftRoomPageClient.tsx'), 'utf8')

describe('draft room ↔ Chimmy wiring', () => {
  it('mounts the helper panel in the phone tray', () => {
    expect(src).not.toMatch(/helperPanel=\{undefined\}/)
    expect(src).toMatch(/helperPanel=\{helperPanelNode\}/)
    expect(src).toMatch(/const helperPanelNode = \(\s*<DraftHelperPanel/)
  })

  it('gives the right dock a Chimmy tab and lets buttons open it', () => {
    expect(src).toMatch(/chimmyBody=\{/)
    expect(src).toMatch(/openTabRequest=\{rightDockOpenRequest\}/)
  })

  it('routes every Ask Chimmy button through openChimmy, not the bare mobile tab', () => {
    expect(src).not.toMatch(/setMobileTab\('helper'\)\}/)
    expect(src.match(/onAiSuggestionClick=\{openChimmy\}/g)?.length).toBe(1)
    expect(src.match(/\sonClick=\{openChimmy\}/g)?.length).toBe(2)
  })

  it('passes the room’s recommendation and Chimmy prompt into the panel', () => {
    const panel = src.slice(src.indexOf('const helperPanelNode = ('), src.indexOf('const keeperPanel ='))
    expect(panel).toMatch(/recommendation=\{recommendationResult\?\.recommendation \?\? null\}/)
    expect(panel).toMatch(/chimmyInitialPrompt=\{chimmyDraftPrompt\}/)
    expect(panel).toMatch(/leagueId=\{leagueId\}/)
  })
})
