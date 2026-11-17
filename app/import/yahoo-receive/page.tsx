/**
 * /import/yahoo-receive — the window the "Send to AllFantasy" bookmark opens from a Yahoo league page.
 * Signed-in only, like /import: an expired session goes through login and comes back here, and the
 * Yahoo page is still waiting (the bookmark listens for ten minutes). See YahooSnapshotReceiver.
 */
import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { YahooSnapshotReceiver } from '@/components/core-app/import/YahooSnapshotReceiver'
import { YAHOO_SNAPSHOT_RECEIVER_PATH } from '@/lib/league-import/yahoo/snapshot/yahooSnapshotBookmarklet'
// af-core.css FIRST: it defines the token layer the af-im rules read (see ImportV4's note).
import '@/components/core-app/af-core.css'
import '@/components/core-app/af-import.css'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Send to AllFantasy', robots: { index: false, follow: false } }

export default async function YahooReceivePage() {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    redirect(`/login?callbackUrl=${encodeURIComponent(YAHOO_SNAPSHOT_RECEIVER_PATH)}`)
  }
  return (
    <div className="af-core af-im">
      <YahooSnapshotReceiver />
    </div>
  )
}
