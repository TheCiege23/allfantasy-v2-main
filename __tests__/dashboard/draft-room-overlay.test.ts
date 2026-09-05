import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
}

describe('dashboard draft room overlay wiring', () => {
  it('DraftTab uses embedded league overlay bridge', () => {
    const src = read('app/league/[leagueId]/tabs/DraftTab.tsx')
    expect(src).toContain('dashboardEmbed')
    expect(src).toContain('openDraftFromEmbeddedLeague')
  })

  it('League layout uses LeagueEmbedGate for embed chrome stripping', () => {
    const src = read('app/league/layout.tsx')
    expect(src).toContain('LeagueEmbedGate')
    expect(src).toContain('ProductShellLayout')
  })
})
