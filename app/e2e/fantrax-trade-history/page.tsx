import { notFound } from 'next/navigation'
import FantraxTradeHistoryHarnessClient from './FantraxTradeHistoryHarnessClient'

/**
 * Preview harness for the Fantrax trade-history upload panel. Not reachable in
 * production. The upload endpoint is stubbed in the browser, so this page needs
 * no session and no database.
 *
 *   /e2e/fantrax-trade-history            the empty panel
 *   /e2e/fantrax-trade-history?state=ok   after a successful upload
 *   /e2e/fantrax-trade-history?state=warn a result with an unmatched team
 *   /e2e/fantrax-trade-history?state=err  a refused file
 */
export default function E2EFantraxTradeHistoryPage() {
  if (process.env.NODE_ENV === 'production') {
    notFound()
  }

  return <FantraxTradeHistoryHarnessClient />
}
