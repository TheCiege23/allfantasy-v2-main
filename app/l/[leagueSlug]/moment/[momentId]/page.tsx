import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { buildShareCardContent, SHARE_MOMENT_TITLES, tribeLabel } from '@/lib/survivor/shareCards/cardContent'
import { loadMomentPageData } from '@/lib/survivor/shareCards/momentPage'
import { absoluteSiteUrl, shareMomentPagePath } from '@/lib/survivor/shareCards/momentStore'
import { MomentShareActions } from '@/components/survivor/share/MomentShareActions'
import '@/components/survivor/survivor-core.css'

export const dynamic = 'force-dynamic'

/**
 * Public, read-only Survivor moment page (share cards handoff; laid out per survivor-core §4,
 * MomentPage). The link preview is the `link` render via the sibling `opengraph-image.tsx`.
 *
 * 404 unless the moment is final, published, and the league has share cards on. When the league
 * turned public moment pages off, the private-league state renders instead and carries nothing
 * about the moment. Display names only; the scroll shows names and order, never who voted.
 *
 * `[leagueSlug]` carries the league id: leagues have no slug column in this schema.
 */
type Props = { params: Promise<{ leagueSlug: string; momentId: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { leagueSlug, momentId } = await params
  const data = await loadMomentPageData(leagueSlug, momentId, { details: false })
  if (!data) return { title: 'Moment not found · AllFantasy', robots: { index: false, follow: false } }
  if (data.state === 'private') return { title: 'Private league · AllFantasy', robots: { index: false, follow: false } }
  const content = buildShareCardContent(data.moment.type, data.moment.week, data.moment.payload)
  const title = `${content.headline} · ${content.leagueName}`
  return {
    title: `${title} · AllFantasy`,
    description: content.sub,
    robots: { index: false, follow: true },
    openGraph: { title, description: content.sub, type: 'article', siteName: 'AllFantasy' },
    twitter: { card: 'summary_large_image', title, description: content.sub },
  }
}

function TopBar() {
  return <header className="svm-top">
    <Link href="/" className="svm-brand" aria-label="AllFantasy home"><i aria-hidden>AF</i>AllFantasy</Link>
    <span className="svk-grow" />
    <Link href="/login" className="svk-btn" style={{ background: 'transparent' }}>Sign in</Link>
    <Link href="/leagues/create" className="svk-btn svk-btn-gold">Start a league</Link>
  </header>
}

export default async function SurvivorMomentPage({ params }: Props) {
  const { leagueSlug, momentId } = await params
  const data = await loadMomentPageData(leagueSlug, momentId)
  if (!data) notFound()

  if (data.state === 'private') {
    return <main className="svk" style={{ minHeight: '100vh' }} data-testid="moment-private">
      <TopBar />
      <div className="svm-body" style={{ alignItems: 'center' }}>
        <div className="svk-card" style={{ maxWidth: 520, width: '100%' }}>
          <div className="svk-empty">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/survivor/late/champion-icon.svg" alt="" style={{ filter: 'grayscale(1) brightness(.7)' }} />
            <b>This league is private</b>
            <span>The commissioner turned off public moment pages. Sign in if you&apos;re in this league.</span>
            <Link href="/login" className="svk-btn svk-btn-gold">Sign in</Link>
          </div>
        </div>
      </div>
    </main>
  }

  const { moment, scroll, tribes, more } = data
  const content = buildShareCardContent(moment.type, moment.week, moment.payload)
  const p = moment.payload
  const tribe = tribeLabel(p.tribeName)
  const chips = content.stats.map(stat => `${stat.value} ${stat.label.toLowerCase()}`)
  if (tribe && !chips.some(chip => chip.includes(tribe))) chips.push(tribe)
  const pageUrl = absoluteSiteUrl(shareMomentPagePath(moment))

  return <main className="svk" style={{ minHeight: '100vh' }} data-testid="moment-page">
    <TopBar />
    <div className="svm-body">
      <section className="svk-hero" data-testid="moment-hero">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="svk-hero-bg" src={content.backgroundPath} alt="" />
        <div className="svk-hero-veil" aria-hidden />
        <div className="svk-hero-in" style={{ minHeight: 440 }}>
          <div className="svk-hero-copy">
            <div className="svk-row">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {p.crestPath ? <img src={p.crestPath} alt="" style={{ width: 44 }} /> : null}
              <span className="svk-sub" style={{ fontSize: 14 }}>{content.leagueName} · {content.footerSport} · Week {moment.week}</span>
            </div>
            <span className="svk-pill" style={{ alignSelf: 'flex-start', minHeight: 30, fontSize: 13, letterSpacing: '.1em', textTransform: 'uppercase', color: content.theme.accent, borderColor: content.theme.accent }}>{SHARE_MOMENT_TITLES[moment.type]}</span>
            <h1 style={{ color: content.theme.head }}>{content.headline}</h1>
            <p className="svk-hero-sub">{content.sub}</p>
            {chips.length > 0 && <div className="svk-chips">{chips.map(chip => <span key={chip} className="svk-pill" style={{ minHeight: 30 }}>{chip}</span>)}</div>}
            <MomentShareActions url={pageUrl} title={content.headline} />
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="svk-hero-art svk-float" src={content.heroPath} alt={`${content.kicker}: ${content.headline}`} />
        </div>
      </section>

      <div className="svm-cols">
        {scroll && <section className="svk-card svm-scroll" aria-labelledby="svm-scroll-h" data-testid="moment-scroll">
          <h2 id="svm-scroll-h" className="svk-lbl" style={{ margin: 0 }}>The scroll</h2>
          <div className="svm-paper">
            <span className="svm-paper-sub">Tribal Council · Week {scroll.week}</span>
            <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {scroll.slips.map(slip => <li key={slip.order} className="svm-slip" data-x={slip.struck}>
                <span className="svm-slip-ord">Vote {slip.order}</span>
                <span className="svm-slip-hand">{slip.name}</span>
                {slip.stamp && <span className="svm-stamp">{slip.stamp}</span>}
              </li>)}
            </ol>
            {moment.type === 'out' && <span className="svm-verdict">Voted out</span>}
          </div>
          <span className="svk-faint" style={{ fontSize: 12 }}>Who cast each vote stays secret. This page shows display names only.</span>
        </section>}
        <aside className="svm-aside">
          {tribes.length > 0 && <div className="svk-card2" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }} data-testid="moment-torches">
            <span className="svk-lbl">Still in the game</span>
            {tribes.map(t => <div key={t.name} className="svk-row">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {t.crestUrl ? <img src={t.crestUrl} alt="" style={{ width: 38 }} /> : null}
              <div className="svk-grow" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span className="svk-cinzel" style={{ fontWeight: 700, fontSize: 14, letterSpacing: '.08em', color: t.color ?? '#f1d58a' }}>{t.name}</span>
                <div className="svm-torches" aria-label={`${t.lit} still in, ${t.out} out`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {Array.from({ length: Math.min(t.lit, 20) }, (_, i) => <img key={`l${i}`} src="/survivor/weekly/torch-lit-icon.svg" alt="" />)}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {Array.from({ length: Math.min(t.out, 20) }, (_, i) => <img key={`o${i}`} src="/survivor/weekly/torch-out-icon.svg" alt="" />)}
                </div>
              </div>
            </div>)}
          </div>}
          <div className="svk-card svm-cta">
            <span className="svk-cinzel" style={{ fontWeight: 700, fontSize: 22, lineHeight: 1.2, color: '#f1d58a' }}>Run your own Survivor league</span>
            <span className="svk-sub">Tribes, hidden idols, Tribal Council votes and Exile Island, on top of your fantasy team. Works for NFL, NBA, MLB, NHL, college and soccer.</span>
            <Link href="/leagues/create" className="svk-btn svk-btn-gold" style={{ minHeight: 46 }}>Start a Survivor league</Link>
          </div>
        </aside>
      </div>

      {more.length > 0 && <section aria-labelledby="svm-more-h" style={{ display: 'flex', flexDirection: 'column', gap: 12 }} data-testid="moment-more">
        <h2 id="svm-more-h" className="svk-lbl" style={{ margin: 0 }}>More from {content.leagueName}</h2>
        <div className="svm-more">
          {more.map(item => <Link key={item.href} href={item.href}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <div className="svm-more-art"><img src={item.backgroundPath} alt="" /><img src={item.heroPath} alt="" /></div>
            <span style={{ padding: '12px 14px 2px', fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 700, color: item.accent }}>{item.kicker}</span>
            <span className="svk-cinzel" style={{ padding: '0 14px 14px', fontWeight: 700, fontSize: 16, color: '#f3ead6' }}>{item.headline}</span>
          </Link>)}
        </div>
      </section>}
    </div>
  </main>
}
