import React from 'react'
import { describe, expect, it } from 'vitest'
import { fireEvent, render } from '@testing-library/react'

import { BarList, Heatmap, LineChart, formatTick } from '@/components/core-app/portfolio/PortfolioCharts'

describe('formatTick', () => {
  it('🛑 gives neighbouring ticks distinct labels on a narrow range', () => {
    const ticks = [2_000_000, 2_025_000, 2_050_000, 2_075_000, 2_100_000]
    const labels = ticks.map((t) => formatTick(t, 25_000, 2_100_000))
    expect(new Set(labels).size).toBe(labels.length)
    expect(labels[0]).toBe('2.00M')
  })

  it('drops decimals when the step is a whole unit', () => {
    expect(formatTick(40_000, 10_000, 60_000)).toBe('40K')
    expect(formatTick(7, 1, 10)).toBe('7')
    expect(formatTick(2_500, 500, 3_000)).toBe('2.5K')
  })
})

describe('BarList', () => {
  it('prints the value beside every bar and hands the key back when pressed', () => {
    const picked: string[] = []
    const { getAllByRole, getByText } = render(
      <BarList
        ariaLabel="x"
        items={[
          { key: 'a', label: 'Alpha', value: 3 },
          { key: 'b', label: 'Beta', value: 1, hint: 'hint' },
        ]}
        selected="b"
        onSelect={(k) => picked.push(k)}
        unit={(n) => `${n} leagues`}
      />,
    )
    expect(getByText('3 leagues')).toBeTruthy()
    const buttons = getAllByRole('button')
    expect(buttons[1].getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(buttons[0])
    expect(picked).toEqual(['a'])
  })
})

describe('Heatmap', () => {
  it('renders a count in every judged cell, and marks unknown ones instead of scoring them', () => {
    const picked: string[] = []
    const { getAllByRole, container } = render(
      <Heatmap
        caption="c"
        columns={[
          { id: 'injury', label: 'Injuries' },
          { id: 'fragile', label: 'Thin spots' },
        ]}
        rows={[
          {
            key: '0',
            label: 'League',
            cells: [
              { level: 2, count: 3 },
              { level: 0, count: 0, unknown: 'draft not finished' },
            ],
          },
        ]}
        selected={null}
        onSelect={(r, c) => picked.push(`${r}:${c}`)}
      />,
    )
    const cells = getAllByRole('button')
    expect(cells).toHaveLength(1)
    expect(cells[0].textContent).toBe('3')
    expect(cells[0].getAttribute('data-level')).toBe('2')
    fireEvent.click(cells[0])
    expect(picked).toEqual(['0:injury'])
    expect(container.querySelector('[data-unknown="true"]')?.getAttribute('title')).toBe('draft not finished')
  })
})

describe('LineChart', () => {
  it('says so when nothing is priced', () => {
    const { getByText } = render(
      <LineChart ariaLabel="v" points={[{ key: 'a', label: 'A', value: null, estimated: true }]} valueLabel={String} />,
    )
    expect(getByText(/No priced days/)).toBeTruthy()
  })

  it('walks days with the keyboard and dashes only the estimated stretch', () => {
    const { container, getByRole } = render(
      <LineChart
        ariaLabel="v"
        valueLabel={(n) => `v${n}`}
        points={[
          { key: '1', label: 'Sep 1', value: 10, estimated: true },
          { key: '2', label: 'Sep 2', value: 12, estimated: false },
          { key: '3', label: 'Sep 3', value: 11, estimated: false },
        ]}
      />,
    )
    const svg = getByRole('img')
    const tip = () => container.querySelector('.af-pfc-tip')?.textContent ?? ''
    fireEvent.focus(svg)
    expect(tip()).toContain('v11')
    fireEvent.keyDown(svg, { key: 'ArrowLeft' })
    expect(tip()).toContain('v12')
    expect(tip()).toContain('recorded')
    fireEvent.keyDown(svg, { key: 'Home' })
    expect(tip()).toContain('estimated')
    const segs = [...container.querySelectorAll('path.af-pfc-series')]
    expect(segs.map((p) => p.hasAttribute('data-estimated'))).toEqual([true, false])
  })
})

describe('LineChart day selection', () => {
  it('pins the focused day on Enter and draws its marker', () => {
    const picked: string[] = []
    const { getByRole, container, rerender } = render(
      <LineChart
        ariaLabel="v"
        valueLabel={String}
        onSelect={(k) => picked.push(k)}
        points={[
          { key: 'd1', label: 'Sep 1', value: 10, estimated: true },
          { key: 'd2', label: 'Sep 2', value: 12, estimated: true },
        ]}
      />,
    )
    const svg = getByRole('img')
    fireEvent.focus(svg)
    fireEvent.keyDown(svg, { key: 'Enter' })
    expect(picked).toEqual(['d2'])
    expect(container.querySelector('.af-pfc-pin')).toBeNull()
    rerender(
      <LineChart
        ariaLabel="v"
        valueLabel={String}
        selected="d1"
        onSelect={(k) => picked.push(k)}
        points={[
          { key: 'd1', label: 'Sep 1', value: 10, estimated: true },
          { key: 'd2', label: 'Sep 2', value: 12, estimated: true },
        ]}
      />,
    )
    expect(container.querySelector('.af-pfc-pin')).not.toBeNull()
  })

  it('does not jump the crosshair to the last day when focus comes from a click', () => {
    const { getByRole, container } = render(
      <LineChart
        ariaLabel="v"
        valueLabel={String}
        onSelect={() => {}}
        points={[
          { key: 'd1', label: 'Sep 1', value: 10, estimated: true },
          { key: 'd2', label: 'Sep 2', value: 12, estimated: true },
        ]}
      />,
    )
    const svg = getByRole('img')
    fireEvent.pointerDown(svg)
    fireEvent.focus(svg)
    expect(container.querySelector('.af-pfc-tip')).toBeNull()
  })
})
