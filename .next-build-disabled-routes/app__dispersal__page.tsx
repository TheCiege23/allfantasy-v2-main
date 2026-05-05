import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

/** Short URL for bookmarks / deep links — canonical hub lives under the dashboard. */
export default function DispersalRedirectPage() {
  redirect('/dashboard/dispersal')
}
