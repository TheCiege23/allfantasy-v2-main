import { notFound } from 'next/navigation'
import { SalaryCapHome } from '@/components/salary-cap/SalaryCapHome'

/**
 * The salary cap home on its own: the REAL `SalaryCapHome` the league page renders, reading the same
 * API with the viewer's own session. The whole league page is too heavy to render in a small sandbox;
 * this is the cap home without the shell. Production is refused by app/e2e/layout.tsx; the check below
 * is the redundant second guard.
 *
 *   /e2e/salary-cap-home/<leagueId>
 */
export default async function SalaryCapHomeHarnessPage({ params }: { params: Promise<{ leagueId: string }> }) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { leagueId } = await params
  return (
    <main style={{ maxWidth: 1100, margin: '0 auto', padding: 16 }}>
      <SalaryCapHome leagueId={leagueId} />
    </main>
  )
}
