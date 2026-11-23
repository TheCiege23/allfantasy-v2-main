/**
 * Salary Cap sub-views are readable in light mode (2026-11-07, Salary Cap audit item 3). They sit in the Salary Cap
 * specialty shell, dark in both modes, and are written with Tailwind's text-white — which the global light-mode
 * readability rule turns dark. Measured at 820px light: 5–81 text elements per sub-view under 4.5:1, most ~1:1.
 * Wrapping them in the rule's existing opt-out (`af-draft-dark`) keeps the shell's theme, as Cap home already has;
 * after: 0 below 4.5:1 on all seven views in both modes. The AI panel's two cyan buttons were 3.55:1 even in dark.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { SalaryCapHome } from '@/components/salary-cap/SalaryCapHome'
import type { SalaryCapView } from '@/components/salary-cap/types'

vi.mock('next/link', () => ({ default: ({ children, ...props }: any) => <a {...props}>{children}</a> }))
vi.mock('@/components/salary-cap/CapDashboard', () => ({ CapDashboard: () => <section>view:cap-dashboard</section> }))
vi.mock('@/components/salary-cap/ContractsPage', () => ({ ContractsPage: () => <section>view:contracts</section> }))
vi.mock('@/components/salary-cap/TeamBuilderView', () => ({ TeamBuilderView: () => <section>view:team-builder</section> }))
vi.mock('@/components/salary-cap/StartupAuctionView', () => ({ StartupAuctionView: () => <section>view:draft</section> }))
vi.mock('@/components/salary-cap/SalaryCapAIPanel', () => ({ SalaryCapAIPanel: () => <section>view:ai</section> }))
vi.mock('@/components/salary-cap/SalaryCapRulesView', () => ({ SalaryCapRulesView: () => <section>view:rules</section> }))
vi.mock('@/components/league/specialty/salary/SalaryCapSpecialtyHome', () => ({ SalaryCapSpecialtyHome: () => <section>view:home</section> }))

beforeEach(() => vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ config: {}, ledger: null, contracts: [], futureProjection: [], events: [] }) })))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const SUBVIEWS: SalaryCapView[] = ['cap-dashboard', 'contracts', 'team-builder', 'draft', 'ai', 'rules']

describe('every sub-view sits inside the light-mode opt-out', () => {
  it.each(SUBVIEWS)('%s', async (view) => {
    render(<SalaryCapHome leagueId="l" initialView={view} shellNav />)
    const content = await screen.findByText(`view:${view}`)
    expect(content.closest('.af-draft-dark')?.getAttribute('data-cap-subview')).toBe(view)
  })
  it('the opt-out is the one the global light-mode text rule honours', () => {
    const css = readFileSync('app/globals.css', 'utf8')
    expect(css).toMatch(/html\[data-mode="light"\] \.mode-readable \[class\*="text-white"\]:where\(:not\(\.af-draft-dark, \.af-draft-dark \*\)\)/)
  })
})

describe('AI panel buttons', () => {
  it('no longer use the 3.55:1 cyan-500/80 fill under white text', () => {
    const src = readFileSync('components/salary-cap/SalaryCapAIPanel.tsx', 'utf8')
    expect(src).not.toMatch(/bg-cyan-500\/80[^'"]*text-white/)
    expect(src).toMatch(/bg-cyan-700/)
  })
})
