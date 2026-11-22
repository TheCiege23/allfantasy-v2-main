import { notFound } from 'next/navigation'
import { YahooSnapshotReceiver } from '@/components/core-app/import/YahooSnapshotReceiver'
import { MockFetch } from '../import-v5/MockFetch'
import '@/components/core-app/af-core.css'
import '@/components/core-app/af-import.css'

/**
 * Design/test harness for the "Send to AllFantasy" receiver window. The real one
 * (/import/yahoo-receive) needs a session; this renders the same component with the snapshot API
 * stubbed (see MockFetch, mode yahoo-paste), and records what the bookmark delivered in
 * `window.__afLastPaste`. Build a bookmark that targets it with
 * `buildYahooSnapshotBookmarklet(origin, '/e2e/yahoo-receive')`.
 */
export const dynamic = 'force-dynamic'

export default function YahooReceiveHarness() {
  if (process.env.NODE_ENV === 'production') notFound()
  return (
    <>
      <MockFetch mode="yahoo-paste" />
      <div className="af-core af-im">
        <YahooSnapshotReceiver />
      </div>
    </>
  )
}
