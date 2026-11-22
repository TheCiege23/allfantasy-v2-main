import { notFound } from 'next/navigation'
import FormatHubsHarnessClient from './FormatHubsHarnessClient'

/**
 * DB-free render of /core/hubs/<format> — the REAL FormatHub inside the REAL AfCoreShell, one theme per
 * format (zombie, tournament, survivor, c2c, guillotine, efl), for visual review. Every number is FIXTURE
 * data in `FormatHubData`'s real shape; the broadcast POST is never sent (the capture answers /api/).
 * Production is refused by app/e2e/layout.tsx; the check below is the redundant second guard.
 *
 *   /e2e/format-hubs?format=guillotine
 *   /e2e/format-hubs?format=survivor&empty=1     ← "You're not in a Survivor league yet"
 *   /e2e/format-hubs?format=zombie&partial=1     ← one per-format read failed: counts may be low
 */
export default async function FormatHubsHarnessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  if (process.env.NODE_ENV === 'production') notFound()
  const sp = await searchParams
  return <FormatHubsHarnessClient format={sp.format ?? 'guillotine'} empty={sp.empty === '1'} partial={sp.partial === '1'} />
}
