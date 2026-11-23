import { notFound } from 'next/navigation'
import DefenseHubHarnessClient from '../DefenseHubHarnessClient'

/**
 * DB-free render of the IDP Defense hub — the REAL DefenseHubClient (with its trade board) inside the real /core
 * shell, or on its own as /idp/defense-hub shows it — for visual review. Its two reads are answered in the browser
 * from app/e2e/defense-hub/fixtures.ts; `?state=` picks one of DEFENSE_HUB_VARIANTS. Any other /api/ call gets a
 * 503. Production is refused by app/e2e/layout.tsx; the check below is the redundant second guard.
 *
 *   /e2e/defense-hub/core        /e2e/defense-hub/standalone        /e2e/defense-hub/core?state=<variant>
 */
export default async function DefenseHubHarnessPage({
  params,
  searchParams,
}: {
  params: Promise<{ screen: string }>
  searchParams: Promise<{ state?: string }>
}) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { screen } = await params
  const { state } = await searchParams
  if (screen !== 'core' && screen !== 'standalone') notFound()
  return <DefenseHubHarnessClient screen={screen} state={state ?? 'full'} />
}
