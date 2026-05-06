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

  it('LeagueShell dispersal banner uses postMessage in embed mode', () => {
    const src = read('app/league/[leagueId]/LeagueShell.tsx')
    expect(src).toContain('postOpenDraftOverlayMessage')
    expect(src).toContain('league-shell-dispersal-draft-embed-cta')
  })

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
