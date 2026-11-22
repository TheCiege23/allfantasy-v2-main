import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { resolvePlatformUser } from '@/lib/platform/current-user'
import { afcSnapshot, isAfcPilotLeague, loadAfcPilot } from '@/lib/afc-championships/staging'
import { AfcChampionshipsPanel } from '@/components/core-app/commissioner/AfcChampionshipsPanel'

export const dynamic = 'force-dynamic'

export default async function AfcChampionshipsPage({ params }: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await params
  if (!isAfcPilotLeague(leagueId)) notFound()
  const { appUserId } = await resolvePlatformUser()
  if (!appUserId) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/league/${leagueId}/afc-championships`)}`)
  }
  const pilot = await loadAfcPilot(leagueId, appUserId, 'bracket')
  if (!pilot) notFound()
  const bracket = await afcSnapshot(pilot)
  return (
    <main className="mx-auto max-w-4xl space-y-6 p-4 sm:p-8">
      {pilot.userId === appUserId ? (
        <Link className="underline" href={`/league/${encodeURIComponent(leagueId)}?tab=commissioner`}>← Commissioner Hub</Link>
      ) : null}
      <h1 className="text-2xl font-semibold sm:text-3xl">AFC Championships</h1>
      {bracket?.practice && (
        <p>
          Round 4 is open for practice. Saved pairings sync every five minutes.{' '}
          <a className="underline" href="https://docs.google.com/spreadsheets/d/1tNt--agfj1mOlK23IMgacAQ447wng5B5t0Qdj99g8-4/edit#gid=1784291107">
            Open the staging sheet
          </a>
        </p>
      )}
      <AfcChampionshipsPanel leagueId={leagueId} bracket={bracket} />
    </main>
  )
}
