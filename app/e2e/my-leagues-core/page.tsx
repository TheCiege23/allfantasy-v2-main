import MyLeaguesCoreHarnessClient from './MyLeaguesCoreHarnessClient'

/**
 * DB-free render of /core/leagues — My Leagues inside the real AfCoreShell — for visual review.
 * Production is refused by app/e2e/layout.tsx. Mode comes from the real `af_mode` cookie the root
 * layout reads.
 *
 *   /e2e/my-leagues-core
 */
export default function MyLeaguesCoreHarnessPage() {
  return <MyLeaguesCoreHarnessClient />
}
