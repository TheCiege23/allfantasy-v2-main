/**
 * Salary Cap after the 2026-11-23 audit: contracts read on a phone, the team builder knows when you are over the cap,
 * the cap screens follow light mode, Cap Chimmy speaks the same money and plain words, the over-cap amount is said
 * once, the hero stops spelling out a long league name, a pre-draft league is not "in season", and the contracts
 * footer drops its developer wording.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'

vi.mock('next/link', () => ({ default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...rest}>{children}</a> }))
vi.mock('@/hooks/useAfSubGate', () => ({ useAfSubGate: () => ({ handleApiResponse: async () => true }) }))
vi.mock('next-auth/react', () => ({ useSession: () => ({ status: 'authenticated', data: { user: { id: 'u1' } } }), SessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
vi.mock('@/components/subscription/FeatureGate', () => ({ FeatureGate: ({ children }: { children: React.ReactNode }) => <>{children}</>, default: ({ children }: { children: React.ReactNode }) => <>{children}</> }))

import { summary } from '@/app/e2e/salary-cap-league/fixtures'
import { ContractsPage } from '@/components/salary-cap/ContractsPage'
import { TeamBuilderView } from '@/components/salary-cap/TeamBuilderView'
import { CapDashboard } from '@/components/salary-cap/CapDashboard'
import { SalaryCapAIPanel } from '@/components/salary-cap/SalaryCapAIPanel'
import { SalaryCapSpecialtyHome } from '@/components/league/specialty/salary/SalaryCapSpecialtyHome'

const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8')
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('contracts on a phone', () => {
  it('a list that shows salary and years under each name, and plain footer words', () => {
    render(<ContractsPage summary={summary('in_season')} leagueId="L" />)
    const list = screen.getByTestId('salary-cap-contracts-list')
    expect(list.className).toMatch(/sm:hidden/)
    const first = within(list).getAllByRole('listitem')[0]
    expect(first.textContent).toMatch(/\$\d/)
    expect(first.textContent).toMatch(/yr/)
    expect(document.body.textContent).not.toMatch(/shown in transaction flows/)
  })
})

describe('the team builder over the cap', () => {
  it('shows the cap space as over (not green), warns once, and puts money on each position', () => {
    render(<TeamBuilderView summary={summary('over_cap')} leagueId="L" />)
    const space = screen.getByTestId('salary-cap-builder-space')
    expect(space.className).not.toMatch(/emerald|var\(--good\)/)
    expect(document.body.textContent).toMatch(/over the cap by\s*\$12/i)
    expect(screen.getByTestId('salary-cap-builder-pos-WR').textContent).toMatch(/\$\d/)
    expect(document.body.textContent).toMatch(/under contract/i)
  })
})

describe('the over-cap amount is said once on Cap space', () => {
  it('the tile says it; no separate warning box and no current-year "over" row', () => {
    render(<CapDashboard summary={summary('over_cap')} leagueId="L" />)
    const txt = document.body.textContent ?? ''
    // `$12` exactly: not the start of "$129.6".
    expect((txt.match(/\$12(?![\d.])/g) ?? []).length).toBe(1)
  })
})

describe('Cap Chimmy', () => {
  it('the shared money format and no engine wording', () => {
    vi.stubGlobal('fetch', vi.fn())
    render(<SalaryCapAIPanel summary={summary('over_cap')} leagueId="L" />)
    const txt = document.body.textContent ?? ''
    expect(txt).not.toMatch(/\$-\d|Deterministic|league engine/)
    expect(txt).toMatch(/−\$12/)
  })
  it('a tagged player is not an extension candidate', () => {
    expect(read('app/api/leagues/[leagueId]/salary-cap/summary/route.ts')).toMatch(/status !== 'tagged'/)
  })
})

describe('Cap home', () => {
  it('a short hero title, not the league name again, and no "In season" for a pre-draft league', () => {
    render(<SalaryCapSpecialtyHome summary={summary('empty')} onOpenContracts={() => {}} onOpenBid={() => {}} tradesHref="/t" />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Your salary cap')
    expect(document.body.textContent).not.toMatch(/In season — the offseason steps/)
  })
  it('the hero veil covers the text half for salary (the arc ran through the blurb)', () => {
    expect(read('components/league/specialty/specialty.module.css')).toMatch(/\.sp\[data-specialty='salary'\] \.hero>\.veil/)
  })
})

describe('light mode', () => {
  it('Salary Cap joins the shell’s light tokens and drops the always-dark wrapper', () => {
    expect(read('components/league/specialty/specialty.module.css')).toMatch(/:global\(html\[data-mode='light'\]\) \.sp\[data-specialty='salary'\]/)
    expect(read('components/salary-cap/SalaryCapHome.tsx')).not.toMatch(/className="af-draft-dark"/)
    for (const f of ['CapDashboard', 'ContractsPage', 'TeamBuilderView', 'SalaryCapAIPanel', 'SalaryCapRulesView', 'StartupAuctionView', 'ImportedContractsUpload', 'SalaryCapHome']) {
      expect(read(`components/salary-cap/${f}.tsx`), f).not.toMatch(/\btext-white\b|text-white\//)
    }
  })
})
