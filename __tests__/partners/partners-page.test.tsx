// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import PartnersPage from '@/app/partners/page'
import { DEMO_LEAGUES } from '@/lib/partner-portal/demoTenant'

afterEach(() => cleanup())

const renderPage = async (league?: string) => render(await PartnersPage({ searchParams: Promise.resolve(league ? { league } : {}) }))

describe('/partners — the B2B front door with a live demo tenant', () => {
  it('says it is sample data, and shows the four views the principles doc asks for', async () => {
    await renderPage()
    expect(screen.getByRole('note').textContent).toContain('Sample data')
    for (const h of ['League health', 'What the engine recommended, and whether it helped', 'Data quality', 'How it works']) {
      expect(screen.getByRole('heading', { name: h })).toBeTruthy()
    }
    // Every league is a row with a link to its own detail.
    for (const l of DEMO_LEAGUES) {
      expect(screen.getByRole('link', { name: l.name }).getAttribute('href')).toBe(`/partners?league=${l.id}#league`)
    }
    // No detail panel until a league is chosen.
    expect(screen.queryByRole('heading', { name: 'League detail' })).toBeNull()
  })

  it('?league= opens that league: its score, risks and evidence', async () => {
    await renderPage('blue-ridge-keepers')
    const detail = screen.getByRole('heading', { name: 'League detail' }).closest('section')!
    expect(within(detail).getByRole('heading', { name: 'Blue Ridge Keepers' })).toBeTruthy()
    expect(detail.textContent).toContain('Four managers inactive')
    expect(detail.textContent).toContain('8 of 12 teams set a lineup this week')
    expect(within(detail).getByRole('link', { name: 'Close' }).getAttribute('href')).toBe('/partners#leagues')
  })

  it('an unknown league id opens nothing (no echo of the query into the page)', async () => {
    await renderPage('<script>x</script>')
    expect(screen.queryByRole('heading', { name: 'League detail' })).toBeNull()
    expect(document.body.innerHTML).not.toContain('<script>x')
  })

  it('status is never colour alone: every tier badge carries its word', async () => {
    await renderPage()
    const table = screen.getByRole('heading', { name: 'League health' }).closest('section')!
    for (const word of ['At risk', 'Watch', 'Steady', 'Strong']) expect(table.textContent).toContain(word)
  })

  it('the charts have table views and hover/focus readouts', async () => {
    await renderPage()
    expect(screen.getAllByText('View as table').length).toBeGreaterThanOrEqual(2)
    const week = screen.getByLabelText(/^Wk 11: [\d,]+ actions$/)
    fireEvent.focus(week)
    expect(screen.getAllByRole('status').some((s) => s.textContent?.includes('Wk 11'))).toBe(true)
  })

  it('🛑 customer-safe language: the word "AI" appears nowhere on the page', async () => {
    await renderPage('iron-horse')
    // Per text node, never body.textContent: that joins neighbours with no space ("…platformAI powered"),
    // and a word-boundary match can then miss the word entirely. A control with an injected label caught it.
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    const offenders: string[] = []
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (/\bAI\b/.test(n.textContent ?? '')) offenders.push(n.textContent!.trim())
    for (const el of Array.from(document.querySelectorAll('[aria-label]'))) {
      const label = el.getAttribute('aria-label') ?? ''
      if (/\bAI\b/.test(label)) offenders.push(label)
    }
    expect(offenders).toEqual([])
  })
})
