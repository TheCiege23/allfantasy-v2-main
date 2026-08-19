/**
 * AllFantasy Decision OS Demo Layer — Phase 1: league-home entry points.
 *
 * Source-level contract test (LeagueTab has too many deps for a cheap RTL render;
 * the live render is covered by browser proof e2e). Proves league home launches
 * BOTH intelligence hubs with correct routes + gating, and that the demo entry
 * copy carries no recommendation guarantees or raw IDs.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const leagueTab = fs.readFileSync(path.join(process.cwd(), 'app/league/[leagueId]/tabs/LeagueTab.tsx'), 'utf8')
// The Decision OS launcher section only (scoped so we don't scan unrelated cards).
const launcher = leagueTab.match(/aria-label="League intelligence"[\s\S]*?<\/section>/)?.[0] ?? ''

describe('Decision OS Demo Layer — league-home launchers', () => {
  it('exposes a Manager Intelligence entry to /manager-hub, gated by the hub client flag', () => {
    expect(launcher).toContain('data-testid="nav-manager-intelligence"')
    expect(launcher).toMatch(/href=\{`\/league\/\$\{league\.id\}\/manager-hub`\}/)
    expect(launcher).toContain('Manager Intelligence')
    // shown only when the Manager hub client flag is on
    expect(launcher).toContain('NEXT_PUBLIC_MANAGER_INTELLIGENCE_HUB_ENABLED')
  })

  it('exposes a Commissioner "League Intelligence" entry to /intelligence', () => {
    expect(launcher).toContain('data-testid="nav-commissioner-intelligence"')
    expect(launcher).toMatch(/href=\{`\/league\/\$\{league\.id\}\/intelligence`\}/)
    expect(launcher).toContain('League Intelligence')
  })

  it('both entries use the parameterized league route (no hardcoded/raw IDs)', () => {
    // exactly two Decision OS launcher links, both templated on league.id
    const hrefs = launcher.match(/href=\{`\/league\/\$\{league\.id\}\/[a-z-]+`\}/g) ?? []
    expect(hrefs.length).toBe(2)
    // no long digit runs (raw provider/league IDs) in the launcher copy
    expect(/\d{6,}/.test(launcher)).toBe(false)
  })

  it('demo entry copy avoids recommendation guarantees / advice claims', () => {
    expect(launcher).toMatch(/Roster health, weekly outlook/i) // manager framing present
    expect(launcher).toMatch(/League health, activity, trade-review workload/i) // commissioner framing present
    for (const banned of [/guaranteed/i, /tells you what to do/i, /automated commissioner/i, /\byou should\b/i, /win your league/i, /guaranteed winning/i]) {
      expect(banned.test(launcher)).toBe(false)
    }
  })
})
