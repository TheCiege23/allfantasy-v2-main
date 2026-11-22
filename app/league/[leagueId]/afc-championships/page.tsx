import Link from 'next/link'
import { notFound } from 'next/navigation'
import { resolvePlatformUser } from '@/lib/platform/current-user'
import { afcSnapshot, loadAfcPilot } from '@/lib/afc-championships/staging'
import { AfcChampionshipsPanel } from '@/components/core-app/commissioner/AfcChampionshipsPanel'

export const dynamic = 'force-dynamic'

export default async function AfcChampionshipsPage({ params }: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await params
  const { appUserId } = await resolvePlatformUser()
  const pilot = appUserId ? await loadAfcPilot(leagueId, appUserId) : null
  if (!pilot) notFound()
  const bracket = await afcSnapshot(pilot)
  return (
    <main className="mx-auto max-w-4xl space-y-6 p-4 sm:p-8">
      <Link className="underline" href={`/league/${encodeURIComponent(leagueId)}?tab=commissioner`}>← Commissioner Hub</Link>
      <h1 className="text-2xl font-semibold sm:text-3xl">AFC Championships</h1>
      <AfcChampionshipsPanel leagueId={leagueId} bracket={bracket} />
    </main>
  )
}
