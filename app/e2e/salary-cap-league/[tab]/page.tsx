import { notFound } from 'next/navigation'
import SalaryCapLeagueHarnessClient from '../SalaryCapLeagueHarnessClient'
import { SALARY_CAP_HARNESS_MOODS, SALARY_CAP_HARNESS_TABS, type SalaryCapHarnessMood } from '../fixtures'

/**
 * DB-free render of a Salary Cap league's cap tabs, for visual review: the real workspace and the real SalaryCapHome,
 * fed by ./fixtures.ts in the browser. Production is refused by app/e2e/layout.tsx (and here, per page).
 *
 *   /e2e/salary-cap-league/cap_dashboard?mood=in_season
 *   tab:  salary_cap | cap_dashboard | cap_contracts | cap_team_builder | cap_auction | cap_ai | cap_rules
 *   mood: in_season | over_cap | auction | commissioner | imported | empty
 */
export default async function SalaryCapLeagueHarnessPage({
  params,
  searchParams,
}: {
  params: Promise<{ tab: string }>
  searchParams: Promise<Record<string, string | undefined>>
}) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { tab } = await params
  if (!SALARY_CAP_HARNESS_TABS.includes(tab)) notFound()
  const sp = await searchParams
  const mood = (SALARY_CAP_HARNESS_MOODS as readonly string[]).includes(sp.mood ?? '') ? (sp.mood as SalaryCapHarnessMood) : 'in_season'
  return <SalaryCapLeagueHarnessClient tab={tab} mood={mood} />
}
