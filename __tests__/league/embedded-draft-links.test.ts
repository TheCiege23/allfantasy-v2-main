import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
}

describe('embedded league draft entry wiring', () => {
  it('WarRoomPanel intercepts draft room links when dashboardEmbed', () => {
    const src = read('components/war-room/WarRoomPanel.tsx')
    expect(src).toContain('dashboardEmbed')
    expect(src).toContain('handleDraftRoomLinkClick')
    expect(src).toContain('parseLeagueDraftNavigationIntent')
  })

  /*
   * ⚠ A "LeagueShell dispersal banner uses postMessage in embed mode" case lived here and had
   * failed since 2026-05-09: the "FIFA" commit (e61858c4a4) removed that CTA and its
   * `postOpenDraftOverlayMessage` call from LeagueShell, and 15c9127811 (2026-09-05) deleted the
   * dashboards that framed the league hub and listened for `af-dashboard-open-draft`. With no
   * parent frame left there is no LeagueShell behaviour to assert, so the case was removed rather
   * than rewritten to pass. The cases below still pin the bridge where it remains in the code.
   */
  it('LeagueSettingsTab opens dispersal via bridge when dashboardEmbed', () => {
    const src = read('app/league/[leagueId]/tabs/LeagueSettingsTab.tsx')
    expect(src).toContain('dashboardEmbed')
    expect(src).toContain('league-settings-dispersal-open-embed')
  })

  it('WarRoomTab passes dashboardEmbed to WarRoomPanel', () => {
    const src = read('app/league/[leagueId]/tabs/WarRoomTab.tsx')
    expect(src).toContain('dashboardEmbed={dashboardEmbed}')
  })

  it('DraftTab uses openDraftFromEmbeddedLeague', () => {
    const src = read('app/league/[leagueId]/tabs/DraftTab.tsx')
    expect(src).toContain('openDraftFromEmbeddedLeague')
  })
})
