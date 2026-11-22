import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { loadSurvivorWatchData } from '@/lib/survivor/spectator/watchPage'
import { SurvivorWatchLive } from '@/components/survivor/watch/SurvivorWatchLive'
import '@/components/survivor/survivor-core.css'

export const dynamic = 'force-dynamic'

/**
 * Public Survivor watch page (spectator mode): fans of the show follow a league's season without
 * playing. Off until the commissioner turns it on; then the episodes, the tribe race and each Tribal
 * Council read as it happens, with display names only (see lib/survivor/spectator/watchModel).
 *
 * `[leagueSlug]` carries the league id: leagues have no slug column in this schema.
 */
type Props = { params: Promise<{ leagueSlug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { leagueSlug } = await params
  const data = await loadSurvivorWatchData(leagueSlug)
  if (!data) return { title: 'League not found · AllFantasy', robots: { index: false, follow: false } }
  if (data.state === 'private') return { title: 'Private league · AllFantasy', robots: { index: false, follow: false } }
  const title = `${data.leagueName}: watch the season`
  const description = `${data.remaining} castaways left. Follow every Tribal Council of this fantasy Survivor league.`
  return {
    title: `${title} · AllFantasy`,
    description,
    robots: { index: false, follow: true },
    openGraph: { title, description, type: 'website', siteName: 'AllFantasy' },
    twitter: { card: 'summary', title, description },
  }
}

export default async function SurvivorWatchPage({ params }: Props) {
  const { leagueSlug } = await params
  const data = await loadSurvivorWatchData(leagueSlug)
  if (!data) notFound()

  if (data.state === 'private') {
    return <main className="svk" style={{ minHeight: '100vh' }} data-testid="watch-private">
      <header className="svm-top">
        <Link href="/" className="svm-brand" aria-label="AllFantasy home"><i aria-hidden>AF</i>AllFantasy</Link>
      </header>
      <div className="svm-body" style={{ alignItems: 'center' }}>
        <div className="svk-card" style={{ maxWidth: 520, width: '100%' }}>
          <div className="svk-empty">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/survivor/late/champion-icon.svg" alt="" style={{ filter: 'grayscale(1) brightness(.7)' }} />
            <b>This league is private</b>
            <span>The commissioner has not opened this season to fans. Sign in if you&apos;re in this league.</span>
            <Link href="/login" className="svk-btn svk-btn-gold">Sign in</Link>
          </div>
        </div>
      </div>
    </main>
  }

  return <SurvivorWatchLive leagueId={leagueSlug} initial={data} />
}
