import StandingsGuideHarnessClient from './StandingsGuideHarnessClient'

/**
 * DB-free render of a league's Standings page with the 2026-11-13 guide. Every figure is SAMPLE data,
 * built through the real board model. Production is refused by app/e2e/layout.tsx.
 */
export default function StandingsGuideHarnessPage() {
  return <StandingsGuideHarnessClient />
}
