import PositionEligibilityHarnessClient from './PositionEligibilityHarnessClient'

/**
 * DB-free render of the NBA commissioner position-eligibility tool
 * (components/league-settings/PositionEligibilityView.tsx). Every player, number and log line is SAMPLE
 * data. Production is refused by app/e2e/layout.tsx.
 *
 *   /e2e/position-eligibility                 commissioner, editing Amen Thompson
 *   /e2e/position-eligibility?view=member     a league member: changed players and the log, no editor
 *   /e2e/position-eligibility?view=empty      commissioner, no changes yet
 */
export default async function PositionEligibilityHarnessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const view = sp.view === 'member' ? 'member' : sp.view === 'empty' ? 'empty' : 'commissioner'
  return <PositionEligibilityHarnessClient view={view} />
}
