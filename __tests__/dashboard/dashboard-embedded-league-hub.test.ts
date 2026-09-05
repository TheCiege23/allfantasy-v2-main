import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
}

describe('dashboard embedded league hub', () => {
  it('LeagueEmbedGate skips ProductShell when embed=1', () => {
    const src = read('components/navigation/LeagueEmbedGate.tsx')
    expect(src).toContain('isEmbedModeFromSearchParams')
    expect(src).toContain('data-af-league-embed-chrome-off')
  })

  it('League page passes embedMode from ?embed=1 into LeagueShell', () => {
    const src = read('app/league/[leagueId]/page.tsx')
    expect(src).toMatch(/embedMode/)
    expect(src).toContain('embedMode={embedMode}')
  })

  it('LeagueShell supports embed mode (center-only AppShell)', () => {
    const src = read('app/league/[leagueId]/LeagueShell.tsx')
    expect(src).toContain('embedMode')
    expect(src).toContain('embedCenterOnly={embedMode}')
  })

  it('AppShell exposes embedCenterOnly for embedded hub column', () => {
    const src = read('app/components/AppShell.tsx')
    expect(src).toContain('embedCenterOnly')
    expect(src).toContain('data-af-embed-center')
  })
})
