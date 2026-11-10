import { notFound } from 'next/navigation'
import BracketPoolHarnessClient from '../BracketPoolHarnessClient'
import { VIEWS } from '../fixtures'

/**
 * DB-free render of the bracket pool dashboard (/brackets/leagues/[leagueId]) — the REAL `PlayoffBracketShell` —
 * for visual review. Every /api/ call from the page gets a 503 from the capture script. Production is refused by
 * app/e2e/layout.tsx; the check below is the redundant second guard.
 *
 *   /e2e/bracket-pool/pool    ← NBA pool mid first round, the viewer a member
 *   /e2e/bracket-pool/owner   ← the same pool as its owner
 *   /e2e/bracket-pool/empty   ← a new pool, nothing picked or played
 */
export default async function BracketPoolHarnessPage({ params }: { params: Promise<{ variant: string }> }) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { variant } = await params
  if (!(variant in VIEWS)) notFound()
  return <BracketPoolHarnessClient variant={variant as keyof typeof VIEWS} />
}
