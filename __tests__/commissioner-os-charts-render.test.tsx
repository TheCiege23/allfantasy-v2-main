import { render } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { ActivityMixDonut } from '@/components/commissioner-os/cards/ActivityMixDonut'
import { AllTimeRecordChart } from '@/components/commissioner-os/cards/AllTimeRecordChart'
import { ManagerFingerprintRadar } from '@/components/commissioner-os/cards/ManagerFingerprintRadar'

/**
 * Do the charts actually DRAW anything?
 *
 * 🛑 EVERY OTHER TEST IN THIS REPO WOULD PASS ON A CHART THAT RENDERS NOTHING. A Recharts chart
 * whose container measures zero still emits its wrapper, its `role="img"` and its aria-label — so
 * an accessibility assertion, a panel-title assertion and a snapshot of the surrounding markup all
 * go green over an empty SVG. That happened twice while these three were being built:
 *
 *   - Entry animation left the donut at 3 of 4 sectors and the radars partly drawn, because jsdom
 *     never advances the animation frames. Fixed by `isAnimationActive={false}`, which is also the
 *     right call for a dashboard people read values off.
 *   - The bar chart rendered ZERO bars for a reason that turned out to be the test harness, not
 *     the component: a blanket `getBoundingClientRect` override made Recharts measure the LEGEND
 *     as taller than the whole chart, leaving a negative plot area.
 *
 * So these assert MARK COUNTS against the input — one sector per slice, one polygon per manager,
 * two bars per team. That is the only assertion that can tell "drew the data" from "drew a frame".
 */

/**
 * ⚠ THE OVERRIDE IS SCOPED TO THE RESPONSIVE CONTAINER ON PURPOSE. Making every element report a
 * chart-sized box is what produced the false bar-chart failure above — the legend, the axes and
 * the tooltip all measured as tall as the plot. Only the container gets the big box.
 */
beforeAll(() => {
  class RO {
    constructor(private cb: ResizeObserverCallback) {}
    observe(el: Element) {
      this.cb(
        [{ target: el, contentRect: { width: 880, height: 360, top: 0, left: 0, bottom: 360, right: 880, x: 0, y: 0, toJSON: () => ({}) } } as unknown as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      )
    }
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', RO)
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const big = this.classList?.contains('recharts-responsive-container')
    const width = big ? 880 : 60
    const height = big ? 360 : 20
    return { width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
  }
})

describe('commissioner-os charts — the marks are actually drawn', () => {
  it('draws one donut sector per activity type', () => {
    // Real proportions from the test league: 51 / 48 / 31 / 7.
    const slices = [
      { label: 'Roster move', value: 51 },
      { label: 'Draft pick', value: 48 },
      { label: 'Waiver', value: 31 },
      { label: 'Trade', value: 7 },
    ]
    const { container } = render(<ActivityMixDonut slices={slices} ariaLabel="probe" />)
    expect(container.querySelectorAll('.recharts-pie-sector')).toHaveLength(4)
  })

  it('folds past the fixed hue list instead of cycling a colour', () => {
    /*
     * Two categories sharing a hue read as the same thing. Past the list they collapse into
     * "Other", so the sector count stops at the palette size rather than wrapping around.
     */
    const many = Array.from({ length: 9 }, (_, i) => ({ label: `Type ${i}`, value: 10 - i }))
    const { container } = render(<ActivityMixDonut slices={many} ariaLabel="probe" />)
    const sectors = container.querySelectorAll('.recharts-pie-sector')
    expect(sectors.length).toBeLessThanOrEqual(5)
    expect(container.textContent).toContain('Other')
  })

  it('draws one radar polygon per manager, not one overlaid chart', () => {
    const managers = Array.from({ length: 11 }, (_, i) => ({
      managerName: `Manager ${i}`,
      aggression: 10 + i,
      activity: 5 + i,
      tradeFrequency: 20 + i,
      riskTolerance: i,
      labels: [],
    }))
    const { container } = render(<ManagerFingerprintRadar managers={managers} ariaLabel="probe" />)
    expect(container.querySelectorAll('.recharts-radar-polygon')).toHaveLength(11)
  })

  it('draws two stacked bars per team', () => {
    const records = Array.from({ length: 12 }, (_, i) => ({
      teamName: `Team ${i}`,
      wins: 60 - i * 3,
      losses: 20 + i * 2,
      seasons: 5,
      titles: i === 0 ? 1 : 0,
    }))
    const { container } = render(<AllTimeRecordChart records={records} ariaLabel="probe" />)
    // Wins + losses for each of twelve teams. This read 0 for an entire debugging session.
    expect(container.querySelectorAll('.recharts-bar-rectangle')).toHaveLength(24)
  })

  it('renders nothing rather than an empty frame when there is no data', () => {
    // An empty chart frame reads as "this league has no activity", which is a different claim.
    expect(render(<ActivityMixDonut slices={[]} ariaLabel="p" />).container.innerHTML).toBe('')
    expect(render(<ManagerFingerprintRadar managers={[]} ariaLabel="p" />).container.innerHTML).toBe('')
    expect(render(<AllTimeRecordChart records={[]} ariaLabel="p" />).container.innerHTML).toBe('')
  })

  it('marks championships in the record chart labels', () => {
    const { container } = render(
      <AllTimeRecordChart
        records={[{ teamName: 'Champs', wins: 40, losses: 10, seasons: 4, titles: 2 }]}
        ariaLabel="probe"
      />,
    )
    expect(container.textContent).toContain('★★')
  })
})
