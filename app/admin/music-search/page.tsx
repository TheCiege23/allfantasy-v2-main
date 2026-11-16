import { redirect } from 'next/navigation'

import { getAdminAccessState } from '@/lib/adminAuth'
import { getMusicSearchUsage, type MusicSearchUsage } from '@/lib/admin-dashboard/MusicSearchUsageService'
import { MusicSearchUsageView } from '@/components/admin/MusicSearchUsageView'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const metadata = { robots: { index: false, follow: false } }

const WINDOWS = [1, 7, 14, 30]

/**
 * How much the Music tab's YouTube search is used, against its two daily limits.
 * Built to answer one question after a week of real use: are 20 a person and 60 for
 * music the right limits? MusicSearchUsageService explains the counters.
 */
export default async function MusicSearchUsagePage(props: { searchParams?: Promise<{ days?: string }> }) {
  const searchParams = await props.searchParams
  const gate = await getAdminAccessState()
  if (gate.status === 'unauthenticated') redirect('/admin-login?next=/admin/music-search')
  if (gate.status === 'forbidden') {
    return (
      <main className="min-h-dvh bg-[#020817] p-8 text-white">
        <p className="text-rose-300">Forbidden — admin access required.</p>
      </main>
    )
  }

  const days = WINDOWS.includes(Number(searchParams?.days)) ? Number(searchParams?.days) : 7
  let data: MusicSearchUsage | null = null
  let error: string | null = null
  try {
    data = await getMusicSearchUsage({ days })
  } catch (err) {
    error = err instanceof Error ? err.message : 'Could not read music search usage'
  }

  return <MusicSearchUsageView data={data} error={error} windows={WINDOWS} />
}
