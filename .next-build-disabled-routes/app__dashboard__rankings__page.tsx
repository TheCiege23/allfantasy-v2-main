import { redirect } from 'next/navigation'

/** Rankings UI lives at `/af-rankings` (workaround for unstable `/dashboard/rankings` route). */
export default function DashboardRankingsRedirectPage() {
  redirect('/af-rankings')
}
