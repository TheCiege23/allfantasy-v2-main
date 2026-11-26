import { notFound } from 'next/navigation'
import GuillotineRulesHarnessClient from './GuillotineRulesHarnessClient'

/**
 * DB-free render of the Guilly rules page (components/league-settings/home/GuillotineRulesPage.tsx) for visual
 * review: the real page, fed by a fixture answered in the browser. Saves are accepted and echoed, never sent.
 * Production is refused by app/e2e/layout.tsx (and here, per page).
 *
 *   /e2e/guillotine-rules
 *   plan=free        without AF Commissioner (paid rules locked)
 *   teams=20&end=10  a schedule that cannot reach a champion
 *   locked=1         the first chop has happened
 */
export default async function GuillotineRulesHarnessPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (process.env.NODE_ENV === 'production') notFound()
  const sp = await searchParams
  const int = (v: string | undefined, fallback: number) => (v && Number.isInteger(Number(v)) ? Number(v) : fallback)
  return <GuillotineRulesHarnessClient paid={sp.plan !== 'free'} teamCount={int(sp.teams, 12)} endWeek={int(sp.end, 18)} locked={sp.locked === '1'} />
}
