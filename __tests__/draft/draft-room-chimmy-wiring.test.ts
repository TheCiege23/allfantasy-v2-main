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
    const node = src.slice(src.indexOf('const helperPanelNode = ('), src.indexOf('const keeperPanel ='))
    expect(node).toMatch(/<DraftHelperPanel\s/)
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

  it('opens only the Chimmy surface on screen, not every one (both layouts are always mounted)', () => {
    const body = src.slice(src.indexOf('const openChimmy = useCallback('), src.indexOf('}, [setMobileTab])'))
    expect(body).toMatch(/const surface = currentChimmySurface\(\)/)
    expect(body).toMatch(/if \(surface === 'right_dock'\) \{\s*setRightDockOpenRequest/)
    expect(body).toMatch(/else if \(surface === 'bottom_dock'\) \{\s*setCenterDockTab\('ai'\)\s*setDockChimmyOpen\(true\)/)
    expect(body).toMatch(/\} else \{\s*setMobileTab\('helper'\)\s*\}/)
  })

  it('passes the room’s recommendation and Chimmy prompt into the panel', () => {
    const panel = src.slice(src.indexOf('const helperPanelNode = ('), src.indexOf('const keeperPanel ='))
    expect(panel).toMatch(/recommendation=\{recommendationResult\?\.recommendation \?\? null\}/)
    expect(panel).toMatch(/chimmyInitialPrompt=\{chimmyDraftPrompt\}/)
    expect(panel).toMatch(/leagueId=\{leagueId\}/)
  })
})

describe('draft room ↔ commissioner control center', () => {
  it('warms the control center chunk for commissioners so opening the assistant cannot starve it', () => {
    expect(src).toMatch(
      /if \(!isCommissioner\) return\s*void import\('@\/components\/app\/draft-room\/CommissionerControlCenterModal'\)/,
    )
  })
})

describe('draft room ↔ Chimmy AI manager slot', () => {
  it('asks for a Chimmy-managed team’s pick after the shared delay, naming the pick it means', () => {
    expect(src).toMatch(/import \{ CHIMMY_PICK_DELAY_MS \} from '@\/lib\/commissioner-ai-draft-manager\/chimmyPickTiming'/)
    expect(src).toMatch(/chimmyManagedRosterIds\.includes\(currentPick\.rosterId\)/)
    expect(src).toMatch(/\/draft\/chimmy-manager-pick`/)
    expect(src).toMatch(/body: JSON\.stringify\(\{ expectedOverall: chimmyOnClockOverall \}\)/)
    expect(src).toMatch(/setTimeout\(\(\) => void requestPick\(0\), CHIMMY_PICK_DELAY_MS/)
  })

  it('reads the managed teams for every member, and tells the top bar Chimmy is picking', () => {
    expect(src).toMatch(/setChimmyManagedRosterIds\(/)
    expect(src).toMatch(/chimmyManagerOnClock=\{chimmyOnClock\}/)
  })
})

describe('draft room ↔ Decision OS', () => {
  it('puts the manager.draft.pick card on top of the assistant, refetching as the board moves', () => {
    const panel = src.slice(src.indexOf('const helperPanelNode = ('), src.indexOf('const keeperPanel ='))
    expect(panel.indexOf('<DraftDecisionOsCard')).toBeGreaterThan(-1)
    expect(panel.indexOf('<DraftDecisionOsCard')).toBeLessThan(panel.indexOf('<DraftHelperPanel'))
    expect(panel).toMatch(/refreshKey=\{`\$\{currentPick\?\.overall \?\? 'none'\}:\$\{session\.status\}:/)
  })
})
