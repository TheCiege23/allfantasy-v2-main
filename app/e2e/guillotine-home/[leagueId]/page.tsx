import { notFound } from 'next/navigation'
import { GuillotineHome } from '@/components/guillotine/GuillotineHome'

/**
 * The Guilly tab on its own: the REAL `GuillotineHome`, which is what the league page's Guilly tab
 * (app/league/[leagueId]/tabs/GuillotineTab.tsx) renders for a native guillotine league. The whole
 * league page is too heavy to render in a small sandbox; this is the tab without the shell, reading the
 * same APIs with the viewer's own session. Production is refused by app/e2e/layout.tsx; the check
 * below is the redundant second guard.
 *
 *   /e2e/guillotine-home/<leagueId>?sport=NBA
 */
export default async function GuillotineHomeHarnessPage({
  params,
  searchParams,
}: {
  params: Promise<{ leagueId: string }>
  searchParams: Promise<{ sport?: string; name?: string }>
}) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { leagueId } = await params
  const { sport, name } = await searchParams
  return (
    <main style={{ maxWidth: 1100, margin: '0 auto', padding: 16 }}>
      <GuillotineHome leagueId={leagueId} sport={String(sport ?? 'NFL').toUpperCase()} leagueName={name} />
    </main>
  )
}
