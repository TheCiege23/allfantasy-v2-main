/**
 * Phase 4.3 — Rankings UI enhancements regression guards.
 *
 * Structural + rendering tests: test IDs preserved, Dashboard V2 motion classes
 * present, color-grammar wiring, the honest empty-state "Import" CTA, and the
 * CareerProgressionStrip's real-data-only self-gate.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import { LegacySnapshotCard } from '@/app/dashboard/components/LegacySnapshotCard'
import { CareerProgressionStrip } from '@/app/dashboard/components/CareerProgressionStrip'

// next/link is a simple pass-through in tests; unlike DashboardShell tests we
// don't need the routing behavior, only the rendered anchor + href.
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href, ...(props as Record<string, unknown>) }, children as React.ReactNode),
}))

const root = resolve(__dirname, '..')
const snapshotSrc = readFileSync(resolve(root, 'app/dashboard/components/LegacySnapshotCard.tsx'), 'utf8')
const progressionSrc = readFileSync(
  resolve(root, 'app/dashboard/components/CareerProgressionStrip.tsx'),
  'utf8',
)

describe('LegacySnapshotCard — Phase 4.3 upgrade (structural)', () => {
  it('preserves the widget testid + wires the individual stat testids', () => {
    expect(snapshotSrc).toContain('data-testid="legacy-snapshot-card"')
    for (const t of [
      'data-testid={testid}',
      'legacy-stat-rank',
      'legacy-stat-tier',
      'legacy-stat-xp',
    ]) {
      expect(snapshotSrc).toContain(t)
    }
  })

  it('applies shared Dashboard V2 motion classes (warroom-card + fade + pressable)', () => {
    expect(snapshotSrc).toContain('warroom-card')
    expect(snapshotSrc).toContain('warroom-fade-in-stagger')
    expect(snapshotSrc).toContain('warroom-pressable')
  })

  it('renders an honest empty-state CTA when no rank fields are present', () => {
    render(<LegacySnapshotCard rankPayload={null} />)
    expect(screen.getByTestId('legacy-snapshot-import-cta')).toBeTruthy()
    const cta = screen.getByTestId('legacy-snapshot-import-cta') as HTMLAnchorElement
    expect(cta.getAttribute('href')).toBe('/import')
  })

  it('hides the empty-state CTA when the payload carries any value', () => {
    render(<LegacySnapshotCard rankPayload={{ xp: 4200 }} />)
    expect(screen.queryByTestId('legacy-snapshot-import-cta')).toBeNull()
    const xpTile = screen.getByTestId('legacy-stat-xp')
    expect(xpTile.textContent).toContain('4200')
  })

  it('honors `imported: true` even when values are missing (no CTA)', () => {
    render(<LegacySnapshotCard rankPayload={{ imported: true }} />)
    expect(screen.queryByTestId('legacy-snapshot-import-cta')).toBeNull()
  })
})

describe('CareerProgressionStrip — Phase 4.3 (real-data only)', () => {
  it('self-gates to null when no career fields have positive values', () => {
    const { container } = render(<CareerProgressionStrip rankPayload={null} />)
    expect(container.firstChild).toBeNull()

    const { container: c2 } = render(
      <CareerProgressionStrip
        rankPayload={{
          careerChampionships: 0,
          careerPlayoffAppearances: 0,
          careerSeasonsPlayed: 0,
          careerLeaguesPlayed: 0,
        }}
      />,
    )
    expect(c2.firstChild).toBeNull()
  })

  it('renders when at least one career field is > 0', () => {
    render(
      <CareerProgressionStrip
        rankPayload={{ careerChampionships: 2, careerPlayoffAppearances: 5, careerSeasonsPlayed: 9, careerLeaguesPlayed: 3 }}
      />,
    )
    const strip = screen.getByTestId('career-progression-strip')
    expect(strip).toBeTruthy()
    // All four values render (as tabular-nums numbers)
    expect(strip.textContent).toContain('2') // championships
    expect(strip.textContent).toContain('5') // playoffs
    expect(strip.textContent).toContain('9') // seasons
    expect(strip.textContent).toContain('3') // leagues
  })

  it('renders even with partial data — only some fields present', () => {
    render(<CareerProgressionStrip rankPayload={{ careerSeasonsPlayed: 4 }} />)
    expect(screen.getByTestId('career-progression-strip')).toBeTruthy()
  })

  it('applies shared Dashboard V2 motion classes', () => {
    expect(progressionSrc).toContain('warroom-card')
    expect(progressionSrc).toContain('warroom-fade-in-stagger')
    expect(progressionSrc).toContain('warroom-pressable')
  })
})
