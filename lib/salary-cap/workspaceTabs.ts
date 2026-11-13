/**
 * Salary Cap in the league workspace (2026-11-07).
 *
 * The Salary Cap screens — cap home and bid check, cap dashboard, contracts, team builder, startup auction, cap AI,
 * rules — were all built, but their only entry point was `SalaryCapHome` inside `components/app/tabs/OverviewTab`,
 * which nothing imports any more: `/app/league/[id]` now redirects to `/league/[id]`, and LeagueShell had tabs for
 * Guillotine, Pirate, Survivor, Zombie and Big Brother but none for Salary Cap. A Salary Cap league showed the plain
 * Redraft workspace. This module is the single source for the tabs LeagueShell adds and the view each one opens.
 *
 * ⚠ DETECT BY TYPE *OR* VARIANT. The canonical create path writes `leagueType: 'salary_cap'` and leaves
 * `leagueVariant` null (the same gap the Zombie note in createCanonicalLeagueInTransaction records), while the
 * legacy path and `isSalaryCapLeague` key on the variant. The summary route accepts either (a config row is enough),
 * so the workspace must too — keying on the variant alone would hide the tabs from every newly created cap league.
 */
import type { SalaryCapView } from '@/components/salary-cap/types'

export const SALARY_CAP_VALUE = 'salary_cap'

export function isSalaryCapWorkspaceLeague(league: { leagueVariant?: string | null; leagueType?: string | null }): boolean {
  return String(league.leagueVariant ?? '').toLowerCase() === SALARY_CAP_VALUE || String(league.leagueType ?? '').toLowerCase() === SALARY_CAP_VALUE
}

/** Tab id → [label, the SalaryCapHome view it opens]. Order is the sidebar order. */
export const SALARY_CAP_TABS: ReadonlyArray<{ id: string; label: string; view: SalaryCapView }> = [
  { id: 'salary_cap', label: 'Cap home', view: 'home' },
  { id: 'cap_dashboard', label: 'Cap space', view: 'cap-dashboard' },
  { id: 'cap_contracts', label: 'Contracts', view: 'contracts' },
  { id: 'cap_team_builder', label: 'Team builder', view: 'team-builder' },
  { id: 'cap_auction', label: 'Startup auction', view: 'draft' },
  { id: 'cap_ai', label: 'Cap AI', view: 'ai' },
  { id: 'cap_rules', label: 'Cap rules', view: 'rules' },
]

export const SALARY_CAP_TAB_IDS: ReadonlySet<string> = new Set(SALARY_CAP_TABS.map((t) => t.id))

export function salaryCapViewForTab(tabId: string): SalaryCapView {
  return SALARY_CAP_TABS.find((t) => t.id === tabId)?.view ?? 'home'
}

/** `?tab=` / `?view=` aliases, merged into LeagueShell's deep-link map. */
export const SALARY_CAP_TAB_ALIASES: Record<string, string> = {
  salary_cap: 'salary_cap',
  cap: 'salary_cap',
  cap_home: 'salary_cap',
  cap_dashboard: 'cap_dashboard',
  cap_space: 'cap_dashboard',
  cap_contracts: 'cap_contracts',
  contracts: 'cap_contracts',
  cap_team_builder: 'cap_team_builder',
  team_builder: 'cap_team_builder',
  cap_auction: 'cap_auction',
  auction: 'cap_auction',
  cap_ai: 'cap_ai',
  cap_rules: 'cap_rules',
}
