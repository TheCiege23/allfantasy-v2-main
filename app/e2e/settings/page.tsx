import SettingsHarnessClient from './SettingsHarnessClient'

/**
 * DB-free render of the /settings hub, for visual review. Production is refused by app/e2e/layout.tsx.
 *
 *   /e2e/settings                 one thing to finish (a bio) — the owner's own account on 2026-11-14
 *   /e2e/settings?state=many      several things to check, notifications off, payment overdue
 *   /e2e/settings?state=clear     nothing to do, free plan
 */
export default async function SettingsHarnessPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>
}) {
  const { state } = await searchParams
  return <SettingsHarnessClient state={state === 'many' || state === 'clear' ? state : 'one'} />
}
