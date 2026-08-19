/**
 * Fantasy OS Suite — Phase V10.0: customer-copy neutrality guard.
 *
 * Production-readiness audit found the internal engine name "Decision OS" (which must stay invisible to
 * customers) and resolver implementation language leaking into rendered customer-facing copy in several
 * Decision OS card empty/unavailable/error states. Fixed in V10.0. This durable guard prevents
 * re-introduction: no customer-facing string prop (or visible text) on these surfaces may contain
 * implementation terminology. Comments and imports are legitimately allowed to reference "Decision OS".
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/** Customer-facing surfaces that render Decision OS output but must not name the engine or its internals. */
const CUSTOMER_SURFACES = [
  'app/fantasy-os/FantasyOsGateway.tsx',
  'app/league/[leagueId]/tabs/LeagueTab.tsx',
  'components/decision-os/LeagueAnalyticsCard.tsx',
  'components/decision-os/UserOsCard.tsx',
  'components/decision-os/CommissionerLeagueHealthRanking.tsx',
  'components/decision-os/MissionControlCard.tsx',
  'components/decision-os/LeagueContextCard.tsx',
  'components/decision-os/ManagerCommandCenterSection.tsx',
  // Commissioner Hub empty-state + League Pulse copy — added after the RC1 hotfix, where a
  // customer-visible "Decision OS" string reached production /commissioner-hub via these surfaces.
  'components/redraft/CommissionerShowcasePanel.tsx',
  'lib/decision-os/league-pulse.ts',
  // Fantasy OS enterprise workspace launch card (task_39ac1c17) — customer-facing dashboard surface.
  'app/dashboard/components/FantasyOsLaunchCard.tsx',
  // Fantasy OS Phase 4 executive intelligence workspace — customer-facing executive surfaces.
  'components/fantasy-os/executive/ExecutiveWorkspace.tsx',
  'components/fantasy-os/executive/primitives.tsx',
  'components/fantasy-os/executive/charts.tsx',
  'app/fantasy-os/executive/page.tsx',
  // AF_GATE0 trial funnel — the universal dashboard is the logged-out "money moment" board;
  // its chrome and copy must never leak the internal engine name (fixed in the Gate 0 build).
  'app/dashboard/universal/UniversalLeaguesBoard.tsx',
  'app/dashboard/universal/components/UniversalDashboardShell.tsx',
  'app/dashboard/universal/components/DashboardHeader.tsx',
  'app/dashboard/universal/components/OsLauncherStrip.tsx',
  'app/dashboard/universal/components/Sidebar.tsx',
]

// Implementation terms that must never appear in customer-visible strings.
const FORBIDDEN = /(Decision OS|\bresolver\b|evidence port|\bcorpus\b|adapter payload|shadow-compare)/i
// A customer-visible string is a labeled prop or visible JSX text (not a code identifier/comment/import).
const STRING_PROP = /(message|description|title|label|aria-label|eyebrow|placeholder|sub|sub2|body\d?)\s*=\s*["'`][^"'`]*$/i

function isCommentOrImport(line: string): boolean {
  const t = line.trim()
  return t.startsWith('*') || t.startsWith('//') || t.startsWith('/*') || t.startsWith('import ') || t.startsWith('* ')
}

describe('customer copy neutrality — no implementation terminology on executive surfaces', () => {
  for (const rel of CUSTOMER_SURFACES) {
    it(`${rel} renders no implementation terminology in customer copy`, () => {
      const abs = path.join(process.cwd(), rel)
      const src = fs.readFileSync(abs, 'utf8')
      const offenders: string[] = []
      for (const raw of src.split(/\r?\n/)) {
        if (isCommentOrImport(raw)) continue
        // a labeled string prop with a forbidden term, OR forbidden term inside any quoted string on a
        // non-comment line
        const quoted = raw.match(/["'`]([^"'`]*)["'`]/g) ?? []
        for (const q of quoted) {
          if (FORBIDDEN.test(q)) offenders.push(`${rel}: ${q.trim()}`)
        }
      }
      expect(offenders, offenders.join('\n')).toEqual([])
    })
  }

  it('the forbidden matcher actually catches the terms it should (self-check)', () => {
    expect(FORBIDDEN.test('receiving Decision OS insights')).toBe(true)
    expect(FORBIDDEN.test('could not be resolved')).toBe(false) // plain English is fine
    expect(FORBIDDEN.test('the resolver failed')).toBe(true)
    expect(FORBIDDEN.test('your executive intelligence')).toBe(false)
  })
})
