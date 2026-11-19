import DefenseHubGuideHarnessClient from './DefenseHubGuideHarnessClient'

/**
 * DB-free render of a league's Defense Hub (2026-11-14 simplification): the "who leads your defense"
 * headline, your defenders, the league trade board opening at its top 25, "How much they play", and the
 * folded method notes. Every figure is SAMPLE data. Production is refused by app/e2e/layout.tsx.
 */
export default function DefenseHubGuideHarnessPage() {
  return <DefenseHubGuideHarnessClient />
}
