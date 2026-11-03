import { notFound } from 'next/navigation'
import RedraftLeagueHomeHarnessClient, { type HarnessScreen } from './RedraftLeagueHomeHarnessClient'

/**
 * DB-free render of the redraft League home batch (A1) for visual review — the REAL NativeLeagueHome,
 * NflRedraftLeagueHomeDashboard and DraftTab inside the real workspace, fed by a fetch stub that
 * answers the endpoints those components already call with labelled fixture payloads. Production is
 * refused by app/e2e/layout.tsx (and here, per page, for the same reason). Mode comes from the real
 * `af_mode` cookie the root layout reads. Three static routes share this:
 *
 *   /e2e/redraft-league/home?sport=NBA&phase=in_season&week=4
 *   /e2e/redraft-league/home?sport=NFL&phase=pre_draft
 *   /e2e/redraft-league/football-home?sport=NCAAF&phase=in_season&week=6
 *   /e2e/redraft-league/draft-hq?sport=MLB&phase=post_draft
 *
 * `empty=1` answers every data endpoint with nothing, so a capture can show each card dropping;
 * `grades=0` returns no draft grades; `commissioner=0` renders a manager's view.
 * Static segments, not a `[screen]` slug: other batches add their own harnesses beside this one under
 * /e2e/redraft-league/, and two different slug names at one level is a Next build error.
 */
export async function renderRedraftLeagueHarness(screen: HarnessScreen, searchParams: Promise<Record<string, string | undefined>>) {
  if (process.env.NODE_ENV === 'production') notFound()
  const sp = await searchParams
  const int = (v?: string) => (v != null && /^\d+$/.test(v) ? Number(v) : null)
  return (
    <RedraftLeagueHomeHarnessClient
      screen={screen}
      sport={sp.sport ?? 'NFL'}
      phase={sp.phase ?? (screen === 'draft' ? 'post_draft' : 'in_season')}
      week={int(sp.week)}
      empty={sp.empty === '1'}
      grades={sp.grades !== '0'}
      commissioner={sp.commissioner !== '0'}
    />
  )
}
