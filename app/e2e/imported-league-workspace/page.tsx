import { notFound } from 'next/navigation'
import ImportedLeagueWorkspaceHarnessClient from './ImportedLeagueWorkspaceHarnessClient'

/**
 * DB-free render of an imported (Fantrax) league inside the league workspace, which native and imported leagues share
 * since 2026-11-22. Production is refused by app/e2e/layout.tsx.
 *
 *   /e2e/imported-league-workspace
 */
export default function ImportedLeagueWorkspaceHarnessPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <ImportedLeagueWorkspaceHarnessClient />
}
