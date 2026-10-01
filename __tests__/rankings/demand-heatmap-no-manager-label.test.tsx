// @vitest-environment jsdom
/**
 * Milestone 32: a characterisation label on a named manager is shown to nobody. The League
 * Demand Heatmap tagged every manager in its "Top proposal targets" list as "Overpayer" (or
 * "Learning"), and offered a "Find Overpayers" button. The tag was never a measurement of the
 * manager: `tagForPos` returned "Overpayer" whenever that manager had made five or more trades at
 * the position, and "Learning" below that — a sample-size flag dressed up as a verdict.
 *
 * The facts stay and are the positive control here: the manager's name, the number of trades at
 * the position, their mean premium and LDI.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const v2 = vi.hoisted(() => ({ getV2Rankings: vi.fn() }))
vi.mock('@/lib/rankings-engine/v2-adapter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/rankings-engine/v2-adapter')>()
  return { ...actual, getV2Rankings: v2.getV2Rankings }
})

import DemandHeatmap from '@/components/DemandHeatmap'
import { RankingsPremiumRow } from '@/components/RankingsPremiumRow'
import { buildLDIHeatmap } from '@/lib/rankings-engine/ldi-heatmap'

const ROOT = path.resolve(__dirname, '..', '..')

/** A target as an older server (or a cached v2 payload) still shapes it — label included. */
const labelledTarget = {
  position: 'QB',
  rosterId: 'Alice',
  name: 'Alice',
  score: 81,
  ldiByPos: 77,
  meanPremiumPct: 0.12,
  nByPos: 7,
  label: 'Overpayer',
}

const cell = {
  pos: 'QB',
  ldi: 77,
  trend: 3,
  posSample: 12,
  leagueSample: 40,
  tag: 'HOT' as const,
  topTargets: [labelledTarget],
  evidence: [{ key: 'LDI', value: 77 }],
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('buildLDIHeatmap — targets carry facts, never a label', () => {
  it('drops a label even when the v2 payload still carries one', async () => {
    v2.getV2Rankings.mockResolvedValue({
      leagueId: 'L1',
      leagueName: 'League',
      season: '2026',
      week: 4,
      phase: 'in_season',
      computedAt: 1,
      meta: {
        ldiByPos: { QB: 77 },
        partnerPosCounts: { Alice: { QB: 7 } },
        ldiSampleTotal: 40,
        ldiTrend: { QB: 3 },
        proposalTargets: [labelledTarget],
      },
    })
    const res = await buildLDIHeatmap({ leagueId: 'L1', week: 4, positions: ['QB'] })
    const target = res.cells[0].topTargets[0] as Record<string, unknown>

    // Facts survive (positive control).
    expect(target.name).toBe('Alice')
    expect(target.nByPos).toBe(7)
    expect(target.meanPremiumPct).toBe(0.12)

    expect(Object.keys(target)).not.toContain('label')
    expect(JSON.stringify(res)).not.toMatch(/Overpayer/)
  })
})

describe('DemandHeatmap — no manager label, no label-targeting button', () => {
  it('shows each manager with their trade count and premium, and no label', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          leagueId: 'L1',
          leagueName: 'League',
          season: '2026',
          week: 4,
          phase: 'in_season',
          computedAt: 1,
          cells: [cell],
        }),
      })),
    )
    render(<DemandHeatmap leagueId="L1" week={4} />)
    fireEvent.click(await screen.findByText('QB'))

    await waitFor(() => expect(screen.getByText('Alice')).toBeDefined())
    expect(screen.getByText('7 trades')).toBeDefined()
    expect(screen.getByText('+12.0%')).toBeDefined()

    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/Overpayer/i)
    expect(text).not.toMatch(/Learning/)
    // The button that sent you after "overpayers" is now a plain partner search.
    expect(screen.getByText('Find Trade Partners')).toBeDefined()
  })
})

describe('RankingsPremiumRow — no manager label', () => {
  it('lists the manager with facts only', () => {
    render(
      <RankingsPremiumRow
        heatmapCells={[cell]}
        selectedTeam={null}
        rankHistory={[]}
        tier={'Mid Pack' as never}
        winWindow={'Flexible' as never}
        whatChanged={{ rankDelta: 0, topDrivers: [] }}
        onOpenTradeHub={() => {}}
        onGenerateOffers={() => {}}
      />,
    )
    fireEvent.click(screen.getByText('QB'))

    expect(screen.getByText('Alice')).toBeDefined()
    expect(screen.getByText('7 trades')).toBeDefined()
    expect(document.body.textContent ?? '').not.toMatch(/Overpayer/)
  })
})

describe('league-rankings-v2 no longer mints the label', () => {
  const src = readFileSync(path.join(ROOT, 'lib/rankings-engine/league-rankings-v2.ts'), 'utf8')
  it('has no Overpayer tag and no overpayer-targeting CTA', () => {
    // Positive control: the facts the tag rode on are still computed.
    expect(src).toMatch(/meanPremiumPctForPos/)
    expect(src).toMatch(/nByPos: posN/)
    expect(src).not.toMatch(/Overpayer/)
    expect(src).not.toMatch(/tagForPos/)
    expect(src).not.toMatch(/find_overpayers|Find overpayers/i)
  })
})
