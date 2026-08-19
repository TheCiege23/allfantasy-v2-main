import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * G15.7 nav entry — source-level contract (LeagueTab has too many deps for a cheap RTL
 * render; the live render is covered by the browser proof e2e/commissioner-intelligence-hub.spec.ts).
 */
const leagueTab = fs.readFileSync(path.join(process.cwd(), 'app/league/[leagueId]/tabs/LeagueTab.tsx'), 'utf8')

describe('Commissioner Hub navigation entry', () => {
  it('LeagueTab links to the /intelligence subroute with a labeled, testable entry', () => {
    expect(leagueTab).toMatch(/href=\{`\/league\/\$\{league\.id\}\/intelligence`\}/)
    expect(leagueTab).toContain('data-testid="nav-commissioner-intelligence"')
    expect(leagueTab).toContain('League Intelligence')
  })
})
