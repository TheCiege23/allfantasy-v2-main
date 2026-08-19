/**
 * Phase 4.1 — Import Visual Upgrade regression guards.
 *
 * Structural tests (not screenshots): confirm the visual upgrade preserves the
 * data-testids downstream tests/QA rely on, and applies the shared Dashboard V2
 * motion classes (`warroom-fade-in-stagger`, `warroom-card`, `warroom-pressable`)
 * so a future refactor can't silently drop them.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '..')
const flowSrc = readFileSync(
  resolve(root, 'components/unified-import-ui/LeagueImportFlow.tsx'),
  'utf8',
)
const loadingSrc = readFileSync(
  resolve(root, 'components/unified-import-ui/LegacyImportLoadingScreen.tsx'),
  'utf8',
)

describe('LeagueImportFlow — Phase 4.1 visual upgrade (structural)', () => {
  it('preserves the provider-tab data-testids downstream QA depends on', () => {
    // Canonical-import rewire: the flagship /import Sleeper journey now uses the
    // preview-first canonical discovery flow, not the legacy "Build My Legacy
    // Profile" CTA — so `import-build-legacy-cta` intentionally no longer exists
    // here (that path lives on in the /af-legacy career-history product). The
    // provider tabs keep their testids for QA.
    for (const testid of [
      'import-tab-sleeper',
      'import-tab-yahoo',
      'import-tab-mfl',
      'import-tab-fantrax',
      'import-tab-espn',
    ]) {
      expect(flowSrc, `missing data-testid=${testid}`).toContain(`data-testid={\`import-tab-\${id}\`}`)
    }
  })

  it('applies shared Dashboard V2 motion classes (warroom-* + fade-in-stagger)', () => {
    expect(flowSrc).toContain('warroom-fade-in-stagger')
    expect(flowSrc).toContain('warroom-card')
    // pressable is applied on provider tabs + primary CTA
    expect(flowSrc.split('warroom-pressable').length).toBeGreaterThanOrEqual(3)
  })

  it('applies the fixed-dark theme scope on the /import shell (Phase 4.1 light-theme fix)', () => {
    // Mirrors the Dashboard V2 Phase 3.9A `.af-dashboard-topbar` pattern —
    // the import experience is deliberately dark in every app theme.
    expect(flowSrc).toContain('af-import-shell')
  })

  it('surfaces the flagship "Recommended" provider badge on Sleeper', () => {
    // Tab objects are `{ id, label }` (shape locked by
    // import-page-provider-flow.test.ts), so the badge is rendered by id rather
    // than a `recommended: true` object flag.
    expect(flowSrc).toContain('Recommended')
    expect(flowSrc).toContain("id === 'sleeper'")
  })

  it('includes the step-1 eyebrow chip anchoring the pre-import stage', () => {
    // "Step 2 of 2" belonged to the legacy Sleeper username form, which the
    // canonical discovery flow replaces; the step-1 eyebrow is retained.
    expect(flowSrc).toContain('Step 1 · Choose Platform')
  })
})

describe('LegacyImportLoadingScreen — Phase 4.1 visual upgrade (structural)', () => {
  it('preserves loading + progress testids', () => {
    expect(loadingSrc).toContain('data-testid="legacy-import-loading-screen"')
    expect(loadingSrc).toContain('data-testid="legacy-import-progress-bar"')
  })

  it('uses shared motion tokens (--dash-ease) + warroom-fade-in-stagger entrance', () => {
    expect(loadingSrc).toContain('warroom-fade-in-stagger')
    expect(loadingSrc).toContain('--dash-ease')
    // Predict-blue accent replaces the old cyan-only active step ring so it
    // aligns with the color-grammar's Predict category.
    expect(loadingSrc).toContain('ring-blue-400/40')
  })
})
