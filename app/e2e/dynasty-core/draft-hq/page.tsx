import { notFound } from 'next/navigation'
import DynastyCoreDraftHqHarnessClient from './DynastyCoreDraftHqHarnessClient'

/**
 * DB-free render of /core's Draft HQ (the REAL DraftHq inside the REAL AfCoreShell) for a dynasty
 * league, for visual review. Production is refused here and by app/e2e/layout.tsx. Mode comes from the
 * real `af_mode` cookie.
 *
 *   /e2e/dynasty-core/draft-hq                 ← the rookie draft room: band, your picks, taxi, board
 *   /e2e/dynasty-core/draft-hq?identity=off    ← Draft HQ as a dynasty league rendered before
 *   /e2e/dynasty-core/draft-hq?draft=none      ← an imported league between drafts: picks from the inventory
 */
export default async function DynastyCoreDraftHqHarnessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  if (process.env.NODE_ENV === 'production') notFound()
  const sp = await searchParams
  return <DynastyCoreDraftHqHarnessClient identityOff={sp.identity === 'off'} noDraft={sp.draft === 'none'} />
}
