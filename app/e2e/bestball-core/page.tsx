import { notFound } from 'next/navigation'
import BestBallCoreHarnessClient from './BestBallCoreHarnessClient'

/**
 * DB-free render of the best-ball-only pieces of /core that the per-screen redraft harnesses cannot
 * reach: Home's best ball depth checks (lib/core-app/bestBallDepth.ts) with a best-ball-only player in
 * the triage, and the live standing strip ranked on best ball finals, provisional and final.
 * Production is refused by app/e2e/layout.tsx; the check below is the redundant second guard.
 *
 *   /e2e/bestball-core
 */
export default async function BestBallCoreHarnessPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <BestBallCoreHarnessClient />
}
