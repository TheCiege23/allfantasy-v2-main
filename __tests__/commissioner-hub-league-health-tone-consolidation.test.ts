import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Fantasy OS Suite — Phase V1.2: Visual OS Consistency Completion.
 *
 * `LeagueHealthDashboard`'s 3 private tone tables (`HEALTH_STATUS_CLASSES`, `ACTION_TONE_CLASSES`,
 * `MetricTile`'s inline tone logic) were migrated onto the shared `decisionOsHealthStatusToneClasses`/
 * `decisionOsToneClasses` primitives (`DecisionOsCardPrimitives.tsx`). Source-scan convention (matching
 * `commissioner-hub-command-center-wiring.test.ts`'s own approach) since `CommissionerHubPageClient.tsx`
 * is not fully rendered in tests — this file proves the OLD private tables are actually gone, not just
 * unused, and that the real usage sites call the new shared primitives.
 */
const source = fs.readFileSync(
  path.join(process.cwd(), 'app', 'commissioner-hub', 'CommissionerHubPageClient.tsx'),
  'utf8',
)

describe('CommissionerHubPageClient — League Health tone consolidation (Phase V1.2)', () => {
  it('no longer defines its own private HEALTH_STATUS_CLASSES or ACTION_TONE_CLASSES tables', () => {
    expect(source).not.toContain('const HEALTH_STATUS_CLASSES')
    expect(source).not.toContain('const ACTION_TONE_CLASSES')
  })

  it('imports the shared primitives from DecisionOsCardPrimitives', () => {
    expect(source).toContain('decisionOsHealthStatusToneClasses')
    expect(source).toContain(
      "from '@/components/decision-os/DecisionOsCardPrimitives'",
    )
  })

  it('the League Health status badge calls the shared decisionOsHealthStatusToneClasses', () => {
    expect(source).toContain('decisionOsHealthStatusToneClasses(snapshot.overallStatus)')
  })

  it('Commissioner Actions and MetricTile route through the shared decisionOsToneClasses', () => {
    expect(source).toContain('function actionToneClasses(tone: CommissionerHealthAction')
    expect(source).toContain("decisionOsToneClasses(tone === 'standard' ? 'neutral' : tone)")
    expect(source).toContain(
      "decisionOsToneClasses(tone === 'good' ? 'good' : tone === 'warn' ? 'warning' : 'neutral')",
    )
  })
})
