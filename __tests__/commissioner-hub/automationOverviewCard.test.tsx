/** The "What runs itself" card on the Commissioner Hub. */
import React from 'react'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AutomationOverview } from '@/components/core-app/commissioner/AutomationOverview'

const json = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response
afterEach(() => vi.unstubAllGlobals())

describe('AutomationOverview', () => {
  it('lists each automation with its state and a link to its switch', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({
      supported: true,
      commissionerPlan: true,
      rows: [
        { key: 'fill_empty_starters', group: 'lineups', label: 'Fill empty starting spots before lock', state: 'on', detail: 'Every hour, from the bench', href: '#ch-fill-empty-starters', plan: 'free' },
        { key: 'tanking', group: 'fairness', label: 'Anti-tanking monitor', state: 'off', detail: null, href: '/league/L1/commissioner/integrity', plan: 'commissioner' },
      ],
    })))
    render(<AutomationOverview leagueId="L1" />)
    expect(await screen.findByText(/1 of 2 automations are on/)).toBeTruthy()
    const fill = screen.getByTestId('automation-fill_empty_starters')
    expect(fill.getAttribute('data-state')).toBe('on')
    expect(fill.querySelector('a')!.getAttribute('href')).toBe('#ch-fill-empty-starters')
    expect(screen.getByTestId('automation-tanking').querySelector('a')!.getAttribute('href')).toBe('/league/L1/commissioner/integrity')
  })

  it('shows nothing for a league AllFantasy does not run', async () => {
    const fetchMock = vi.fn(async () => json({ supported: false }))
    vi.stubGlobal('fetch', fetchMock)
    const { container } = render(<AutomationOverview leagueId="L1" />)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await vi.waitFor(() => expect(container.querySelector('[data-testid="automation-overview"]')).toBeNull())
  })
})

describe('the preset buttons', () => {
  it('shows what will change, and saves only after Save', async () => {
    const { fireEvent } = await import('@testing-library/react')
    const calls: Array<[string, RequestInit | undefined]> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push([url, init])
      if (url.includes('automation-preset') && init?.method === 'POST') return json({ preset: 'recommended', changes: [{ step: { key: 'ir_auto_move', on: true }, label: 'Move healthy players off IR', labelEs: 'x' }], needsPlan: [], needsPlanEs: [] })
      if (url.includes('automation-preset')) return json({ preset: 'recommended', changes: [{ step: { key: 'ir_auto_move', on: true }, label: 'Move healthy players off IR', labelEs: 'x' }], needsPlan: ['Anti-tanking monitor'], needsPlanEs: ['y'] })
      return json({ supported: true, commissionerPlan: true, rows: [] })
    }))
    render(<AutomationOverview leagueId="L1" />)
    fireEvent.click(await screen.findByTestId('preset-recommended'))
    expect(await screen.findByText('Move healthy players off IR')).toBeTruthy()
    expect(screen.getByText(/Needs AF Commissioner, so not included/)).toBeTruthy()
    expect(calls.some(([, init]) => init?.method === 'POST')).toBe(false)
    fireEvent.click(screen.getByTestId('preset-confirm'))
    expect(await screen.findByText(/Saved: 1 change/)).toBeTruthy()
    const post = calls.find(([, init]) => init?.method === 'POST')!
    expect(JSON.parse(String(post[1]!.body))).toEqual({ preset: 'recommended' })
  })
})

describe('switching a free automation on the card', () => {
  it('sends that automation’s own request and reloads; paid rows have no switch', async () => {
    const { fireEvent } = await import('@testing-library/react')
    let on = false
    const calls: Array<[string, RequestInit | undefined]> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push([url, init])
      if (url.endsWith('/fill-empty-starters')) { on = true; return json({ ok: true, on: true }) }
      return json({ supported: true, commissionerPlan: true, rows: [
        { key: 'fill_empty_starters', group: 'lineups', label: 'Fill empty starting spots before lock', state: on ? 'on' : 'off', detail: null, detailEs: null, href: '#ch-fill-empty-starters', plan: 'free' },
        { key: 'tanking', group: 'fairness', label: 'Anti-tanking monitor', state: 'off', detail: null, detailEs: null, href: '/x', plan: 'commissioner' },
      ] })
    }))
    render(<AutomationOverview leagueId="L1" />)
    const box = (await screen.findByTestId('automation-toggle-fill_empty_starters')) as HTMLInputElement
    expect(box.checked).toBe(false)
    expect(screen.queryByTestId('automation-toggle-tanking')).toBeNull()
    fireEvent.click(box)
    await vi.waitFor(() => expect((screen.getByTestId('automation-toggle-fill_empty_starters') as HTMLInputElement).checked).toBe(true))
    const post = calls.find(([u]) => u.endsWith('/fill-empty-starters'))!
    expect(post[1]).toMatchObject({ method: 'POST' })
    expect(JSON.parse(String(post[1]!.body))).toEqual({ on: true })
  })
})
