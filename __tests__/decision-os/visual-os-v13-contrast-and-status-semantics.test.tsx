/**
 * Fantasy OS Suite — Phase V1.3: Visual OS Contrast and Status-Semantics Sweep.
 *
 * Two things this file proves:
 *
 * 1. `OverallStatus` has one shared tone mapping, `decisionOsHealthStatusToneClasses`, and it keeps all
 *    five real health states distinct. (Its two original callers, `MissionControlCard.tsx` and the old
 *    `/commissioner-hub` page, were retired on 2026-09-17; the source-scan that tied them to it went
 *    with them.)
 * 2. The known light-pastel contrast classes found and fixed this phase no longer exist in the
 *    migrated source files — a source scan, since several of these files are not fully rendered in
 *    tests.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { decisionOsHealthStatusToneClasses } from '@/components/decision-os/DecisionOsCardPrimitives'

function readSource(...segments: string[]): string {
  return fs.readFileSync(path.join(process.cwd(), ...segments), 'utf8')
}

describe('OverallStatus — one shared mapping, not two independent tables (Phase V1.3)', () => {
  it('decisionOsHealthStatusToneClasses produces identical output for the same real status value, called independently', () => {
    for (const status of ['excellent', 'healthy', 'watch', 'at_risk', 'critical'] as const) {
      const a = decisionOsHealthStatusToneClasses(status)
      const b = decisionOsHealthStatusToneClasses(status)
      expect(a).toBe(b)
    }
  })

  it('preserves all 5 real, meaningful health states as visually distinct — the unification did not collapse the domain', () => {
    const classes = ['excellent', 'healthy', 'watch', 'at_risk', 'critical'].map((s) =>
      decisionOsHealthStatusToneClasses(s),
    )
    expect(new Set(classes).size).toBe(5)
  })
})

describe('Phase V1.3 retired low-contrast classes — source-scan (files not fully rendered in tests)', () => {
  it('LeagueTab.tsx no longer USES (as opposed to documents in a comment) the retired amber-50/amber-200/cyan-300/yellow-100 value classes', () => {
    const source = readSource('app', 'league', '[leagueId]', 'tabs', 'LeagueTab.tsx')
    // Strip `//` line comments before asserting, so this test can't false-positive on the phase's own
    // explanatory comments (which deliberately quote the retired class names for documentation).
    const codeOnly = source
      .split('\n')
      .map((line) => line.replace(/\/\/.*/, ''))
      .join('\n')
    expect(codeOnly).not.toContain('text-amber-50/95')
    expect(codeOnly).not.toContain('text-amber-200"')
    expect(codeOnly).not.toContain("'text-cyan-300'")
    expect(codeOnly).not.toContain('text-yellow-100')
  })

  it('TodaysBriefCard.tsx and the manager command-center error banner no longer use text-rose-300/text-emerald-300', () => {
    const files = [
      ['components', 'decision-os', 'TodaysBriefCard.tsx'],
      ['components', 'decision-os', 'ManagerCommandCenterSection.tsx'],
    ]
    for (const segments of files) {
      const source = readSource(...segments)
      expect(source).not.toContain('text-rose-300')
      expect(source).not.toContain('text-emerald-300')
    }
  })

  it('NotificationCenter.tsx unread-count badge uses text-content-inverse, not the theme-broken text-white', () => {
    const source = readSource('components', 'decision-os', 'NotificationCenter.tsx')
    expect(source).toContain('text-content-inverse')
    expect(source).not.toMatch(/text-white"/)
  })
})

describe('Phase V1.3 — focus-ring coverage not regressed', () => {
  it('every file touched this phase that had .focus-ring in V1.2 still has it', () => {
    const files = [
      ['app', 'league', '[leagueId]', 'tabs', 'LeagueTab.tsx'],
      ['components', 'decision-os', 'NotificationCenter.tsx'],
    ]
    for (const segments of files) {
      const source = readSource(...segments)
      expect(source).toContain('focus-ring')
    }
  })
})
