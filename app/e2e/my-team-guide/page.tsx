import MyTeamGuideHarnessClient from './MyTeamGuideHarnessClient'

/**
 * DB-free render of a league's My team page with the 2026-11-13 guide. Every figure is SAMPLE data.
 * Production is refused by app/e2e/layout.tsx.
 *
 *   /e2e/my-team-guide                 two questionable starters
 *   /e2e/my-team-guide?mode=fix        a starter ruled out
 *   /e2e/my-team-guide?mode=set        nothing to check
 */
export default async function MyTeamGuideHarnessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const mode = sp.mode === 'fix' ? 'fix' : sp.mode === 'set' ? 'set' : 'questionable'
  return <MyTeamGuideHarnessClient mode={mode} />
}
