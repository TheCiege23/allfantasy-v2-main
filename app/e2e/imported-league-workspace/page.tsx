import { notFound } from 'next/navigation'
import ImportedLeagueWorkspaceHarnessClient from './ImportedLeagueWorkspaceHarnessClient'

/**
 * DB-free render of an imported (Fantrax) league inside the league workspace, which native and imported leagues share
 * since 2026-11-22. Production is refused by app/e2e/layout.tsx.
 *
 *   /e2e/imported-league-workspace
 *   /e2e/imported-league-workspace?role=member   (a non-commissioner member: the gear opens the member menu)
 *   /e2e/imported-league-workspace?extras=1      (devy counts in the header, the IDP switch above My Team)
 */
export default async function ImportedLeagueWorkspaceHarnessPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (process.env.NODE_ENV === 'production') notFound()
  const sp = await searchParams
  return <ImportedLeagueWorkspaceHarnessClient member={sp.role === 'member'} extras={sp.extras === '1'} />
}
