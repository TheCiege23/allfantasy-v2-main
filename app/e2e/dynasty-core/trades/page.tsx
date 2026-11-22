import { notFound } from 'next/navigation'
import DynastyCoreTradesHarnessClient from './DynastyCoreTradesHarnessClient'

/**
 * DB-free render of /core Trades for a dynasty league — the REAL TradeCenter inside the REAL AfCoreShell,
 * fed the redraft trades harness's fixture with the league switched to dynasty. The builder's
 * `/trades/rosters` read is answered by the capture script (Playwright `route`), never by a route handler.
 * Production is refused here and by app/e2e/layout.tsx.
 *
 *   /e2e/dynasty-core/trades                 ← "Your draft capital" panel, gold identity
 *   /e2e/dynasty-core/trades?identity=off    ← the same screen as a dynasty league rendered before
 */
export default async function DynastyCoreTradesHarnessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  if (process.env.NODE_ENV === 'production') notFound()
  const sp = await searchParams
  return <DynastyCoreTradesHarnessClient off={sp.identity === 'off'} />
}
