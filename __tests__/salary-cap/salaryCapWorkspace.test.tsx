/**
 * Salary Cap in the league workspace (2026-11-07). Every Salary Cap screen existed, but nothing reached them: the
 * only importer of `SalaryCapHome` was `components/app/tabs/OverviewTab`, which nothing imports, and LeagueShell
 * added no Salary Cap tabs — a Salary Cap league showed the plain Redraft workspace. These cases pin the wiring.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { SALARY_CAP_TABS, isSalaryCapWorkspaceLeague, salaryCapViewForTab } from '@/lib/salary-cap/workspaceTabs'
import { buildNativeLeagueNavigation } from '@/lib/league/nativeLeagueNavigation'
import { getLeagueTabsForViewer } from '@/app/league/[leagueId]/LeagueTabs'
import { SalaryCapHome } from '@/components/salary-cap/SalaryCapHome'

vi.mock('next/link', () => ({ default: ({ children, ...props }: any) => <a {...props}>{children}</a> }))
vi.mock('@/components/salary-cap/CapDashboard', () => ({ CapDashboard: () => <section>view:cap-dashboard</section> }))
vi.mock('@/components/salary-cap/ContractsPage', () => ({ ContractsPage: () => <section>view:contracts</section> }))
vi.mock('@/components/salary-cap/TeamBuilderView', () => ({ TeamBuilderView: () => <section>view:team-builder</section> }))
vi.mock('@/components/salary-cap/StartupAuctionView', () => ({ StartupAuctionView: () => <section>view:draft</section> }))
vi.mock('@/components/salary-cap/SalaryCapAIPanel', () => ({ SalaryCapAIPanel: () => <section>view:ai</section> }))
vi.mock('@/components/salary-cap/SalaryCapRulesView', () => ({ SalaryCapRulesView: () => <section>view:rules</section> }))
vi.mock('@/components/league/specialty/salary/SalaryCapSpecialtyHome', () => ({ SalaryCapSpecialtyHome: () => <section>view:home</section> }))

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ config: {}, ledger: null, contracts: [], futureProjection: [], events: [] }) }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('which leagues get the Salary Cap tabs', () => {
  it('a league created by the canonical path (leagueType only, variant null) counts', () => {
    expect(isSalaryCapWorkspaceLeague({ leagueType: 'salary_cap', leagueVariant: null })).toBe(true)
  })
  it('a legacy league (variant only) counts', () => {
    expect(isSalaryCapWorkspaceLeague({ leagueType: 'dynasty', leagueVariant: 'salary_cap' })).toBe(true)
  })
  it('anything else does not', () => {
    expect(isSalaryCapWorkspaceLeague({ leagueType: 'redraft', leagueVariant: null })).toBe(false)
    expect(isSalaryCapWorkspaceLeague({ leagueType: 'dynasty', leagueVariant: 'big_brother' })).toBe(false)
  })
})

describe('LeagueShell wires every tab', () => {
  const shell = readFileSync('app/league/[leagueId]/LeagueShell.tsx', 'utf8')
  it('adds the Salary Cap block for those leagues', () => {
    expect(shell).toMatch(/if \(isSalaryCapWorkspaceLeague\(league\)\) \{[\s\S]{0,300}SALARY_CAP_TABS/)
  })
  it('renders SalaryCapHome for each Salary Cap tab id, in workspace mode, on the view that tab names', () => {
    for (const { id } of SALARY_CAP_TABS) expect(shell, id).toContain(`case '${id}':`)
    expect(shell).toMatch(/<SalaryCapHome leagueId=\{leagueId\} initialView=\{salaryCapViewForTab\(activeTab\)\} shellNav \/>/)
  })
  it('each tab maps to a distinct view', () => {
    const views = SALARY_CAP_TABS.map(t => salaryCapViewForTab(t.id))
    expect(new Set(views).size).toBe(SALARY_CAP_TABS.length)
  })
})

describe('sidebar', () => {
  it('Salary Cap gets its own group with an icon per view, not "More tools" question marks', () => {
    const tabs = [{ id: 'native_home', label: 'League home' }, ...getLeagueTabsForViewer('NFL', true), ...SALARY_CAP_TABS.map(({ id, label }) => ({ id, label }))]
    const groups = buildNativeLeagueNavigation(tabs, true)
    const cap = groups.find(g => g.id === 'salarycap')
    expect(cap?.title).toBe('Salary cap')
    expect(cap?.items.map(i => i.id)).toEqual(SALARY_CAP_TABS.map(t => t.id))
    expect(cap?.items.some(i => i.icon === 'more')).toBe(false)
    expect(groups.find(g => g.id === 'more')?.items.some(i => SALARY_CAP_TABS.some(t => t.id === i.id))).toBe(false)
  })
})

describe('SalaryCapHome inside the workspace', () => {
  it('opens the view its tab names and draws no second navigation', async () => {
    render(<SalaryCapHome leagueId="l" initialView="contracts" shellNav />)
    expect(await screen.findByText('view:contracts')).toBeTruthy()
    for (const name of ['Chat', 'Waivers', 'Trades', 'Settings']) expect(screen.queryByRole('link', { name: new RegExp(name) })).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Cap Dashboard' })).toBeNull()
  })
  it('outside it (no shellNav) keeps its own links and view switcher', async () => {
    render(<SalaryCapHome leagueId="l" />)
    expect(await screen.findByText('view:home')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Waivers/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cap Dashboard' })).toBeTruthy()
  })
})
