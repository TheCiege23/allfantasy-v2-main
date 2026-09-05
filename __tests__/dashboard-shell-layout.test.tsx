import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '..')
function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

/**
 * Trimmed when the three unrendered dashboards were retired. Three tests here read
 * `app/dashboard/DashboardShell.tsx` and asserted how IT consumed the shell (the balanced
 * three-panel preset, `leftPanel={null}` + FloatingCommunications, `hideRightRail={!isLeagueRoute}`).
 * That file is gone, so those assertions describe nothing.
 *
 * The three kept below are about `AppShell` itself and are unaffected: they pin `hideLeftRail` and
 * `hideRightRail` as ADDITIVE, which is what keeps the league route, matchups, standings, survivor
 * and ProductShell rendering their rails by default. That guarantee outlived the dashboard that
 * prompted it.
 */
describe('AppShell layout preset — rail flags stay additive', () => {
  const appShell = read('app/components/AppShell.tsx')

  it('keeps the shared shell adjacent and full width on desktop', () => {
    expect(appShell).toContain('data-af-layout-mode={balancedDesktopLayout ? \'balanced-three-panel\' : \'legacy-rail-clamp\'}')
    expect(appShell).toContain('md:[grid-template-columns:minmax(280px,40fr)_minmax(0,35fr)_minmax(240px,25fr)]')
  })

  it('AppShell hideLeftRail is additive — the left rail still renders by default', () => {
    // Default (no hideLeftRail) must keep rendering the left rail so every other consumer
    // (league route, etc.) is unaffected.
    expect(appShell).toContain('hideLeftRail = false')
    expect(appShell).toContain('{hideLeftRail ? null : (')
  })

  it('AppShell hideRightRail is additive — the right rail still renders by default (Phase 3.8D)', () => {
    // Symmetric to hideLeftRail: default false so LeagueShell / matchups / standings / survivor /
    // ProductShell keep their right rail unchanged. When true the right <aside> is omitted and the
    // grid becomes a single full-width column.
    expect(appShell).toContain('hideRightRail = false')
    expect(appShell).toContain('{hideRightRail ? null : (')
    expect(appShell).toContain("noLeftNoRight: 'md:[grid-template-columns:minmax(0,1fr)]'")
  })
})
