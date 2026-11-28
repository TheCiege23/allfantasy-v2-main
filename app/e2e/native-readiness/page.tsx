import { notFound } from 'next/navigation'
import NativeReadinessHarnessClient from './NativeReadinessHarnessClient'

/**
 * DB-free render of the "Switch to AllFantasy" readiness card (components/league-home/NativeReadinessCard.tsx),
 * with sample reports. Production is refused by app/e2e/layout.tsx.
 *
 *   /e2e/native-readiness               blocked: several things to fix
 *   /e2e/native-readiness?state=ready   ready, with one heads-up
 *   /e2e/native-readiness?state=mlb     ready, baseball: the switch asks for weekly lineups
 *   /e2e/native-readiness?state=error   the check failed
 */
export default async function NativeReadinessHarnessPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (process.env.NODE_ENV === 'production') notFound()
  const sp = await searchParams
  return <NativeReadinessHarnessClient state={sp.state === 'ready' ? 'ready' : sp.state === 'mlb' ? 'mlb' : sp.state === 'error' ? 'error' : 'blocked'} />
}
