import { notFound } from 'next/navigation'
import DynastyCoreMyTeamHarnessClient from './DynastyCoreMyTeamHarnessClient'

/**
 * DB-free render of /core My team for a dynasty league, for visual review. Production is refused here
 * and by app/e2e/layout.tsx.
 *
 *   /e2e/dynasty-core/myteam                 ← markers, gold identity
 *   /e2e/dynasty-core/myteam?identity=off    ← the same roster as a dynasty league rendered before
 */
export default async function DynastyCoreMyTeamHarnessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  if (process.env.NODE_ENV === 'production') notFound()
  const sp = await searchParams
  return <DynastyCoreMyTeamHarnessClient off={sp.identity === 'off'} />
}
