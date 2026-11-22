import { notFound } from 'next/navigation'
import { cookies } from 'next/headers'
import { CommissionerHub } from '@/components/core-app/screens/CommissionerHub'
import { resolveLanguage } from '@/lib/i18n/constants'
import RedraftCoreStandingsHarnessShell from '../redraft-core/standings/RedraftCoreStandingsHarnessShell'
import { HARNESS_LEAGUE_ID, HARNESS_LEAGUE_NAME, harnessChecklist, harnessCommissioner } from '../redraft-core/standings/fixtures'

/**
 * DB-free render of one league's Commissioner Hub after the 2026-11-14 simplification — the headline
 * answer, the trimmed tiles, "Needs you now", and every other section folded — the REAL screen in the
 * REAL shell, on the redraft harness's SAMPLE league. Unlike /e2e/redraft-core/standings/commissioner it
 * follows the af_lang cookie, so the Spanish can be reviewed. Production is refused by app/e2e/layout.tsx;
 * this check is the redundant second guard.
 */
export default async function CommissionerHubGuidePage() {
  if (process.env.NODE_ENV === 'production') notFound()
  const language = resolveLanguage((await cookies()).get('af_lang')?.value ?? null)
  return (
    <RedraftCoreStandingsHarnessShell
      active="commissioner"
      sport="NFL"
      redraftSport={null}
      leagueId={HARNESS_LEAGUE_ID}
      leagueName={HARNESS_LEAGUE_NAME}
      checklist={harnessChecklist(new Date())}
    >
      <CommissionerHub data={harnessCommissioner(true)} language={language} />
    </RedraftCoreStandingsHarnessShell>
  )
}
