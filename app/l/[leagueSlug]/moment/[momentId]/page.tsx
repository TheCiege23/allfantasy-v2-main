import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { buildShareCardContent, SHARE_MOMENT_TITLES } from '@/lib/survivor/shareCards/cardContent'
import { loadPublicShareMoment, shareMomentImagePath } from '@/lib/survivor/shareCards/momentStore'

export const dynamic = 'force-dynamic'

/**
 * Public, read-only Survivor moment page (share cards handoff). The link preview is the `link`
 * render via the sibling `opengraph-image.tsx` — a page-path image, so link-preview crawlers reach
 * it under the same middleware rules as this page. 404 unless the moment is final, published,
 * and the league has share cards on. Shows display names only.
 *
 * `[leagueSlug]` carries the league id: leagues have no slug column in this schema.
 */
type Props = { params: Promise<{ leagueSlug: string; momentId: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { leagueSlug, momentId } = await params
  const moment = await loadPublicShareMoment(leagueSlug, momentId)
  if (!moment) return { title: 'Moment not found · AllFantasy', robots: { index: false, follow: false } }
  const content = buildShareCardContent(moment.type, moment.week, moment.payload)
  const title = `${content.headline} · ${content.leagueName}`
  return {
    title: `${title} · AllFantasy`,
    description: content.sub,
    robots: { index: false, follow: true },
    openGraph: { title, description: content.sub, type: 'article', siteName: 'AllFantasy' },
    twitter: { card: 'summary_large_image', title, description: content.sub },
  }
}

export default async function SurvivorMomentPage({ params }: Props) {
  const { leagueSlug, momentId } = await params
  const moment = await loadPublicShareMoment(leagueSlug, momentId)
  if (!moment) notFound()
  const content = buildShareCardContent(moment.type, moment.week, moment.payload)

  return (
    <main className="min-h-screen bg-[#07080d] px-4 py-8 text-[#e8eaf2] sm:py-12">
      <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-8 lg:flex-row lg:items-start lg:justify-center lg:gap-12">
        <img
          src={shareMomentImagePath(moment.id, 'post')}
          alt={`${content.kicker}: ${content.headline}`}
          width={1080}
          height={1350}
          className="h-auto w-full max-w-[420px] rounded-2xl shadow-[0_30px_60px_rgba(0,0,0,.55),0_0_0_1px_rgba(255,255,255,.08)]"
        />
        <section className="flex w-full max-w-[420px] flex-col gap-4 lg:pt-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8d93ad]">{SHARE_MOMENT_TITLES[moment.type]} · {content.leagueName}</p>
          <h1 className="font-[Cinzel,serif] text-3xl font-bold leading-tight" style={{ color: content.theme.head }}>{content.headline}</h1>
          <p className="text-base text-[#d6d9e6]">{content.sub}</p>
          <div className="mt-2 rounded-2xl border border-white/10 bg-[#0b0d14] p-5">
            <p className="text-sm font-semibold text-white">Play Survivor with your league</p>
            <p className="mt-1 text-sm text-[#a3a9c2]">Tribes, idols, Tribal Council and a jury, built on top of your fantasy league.</p>
            <Link
              href="/signup"
              className="mt-4 inline-flex min-h-[44px] w-full items-center justify-center rounded-xl bg-[#f2c94c] px-5 text-sm font-semibold text-[#1a1204] hover:bg-[#f1d58a]"
            >
              Join AllFantasy
            </Link>
          </div>
          <p className="text-xs text-[#8d93ad]">Survivor · {content.footerSport}</p>
        </section>
      </div>
    </main>
  )
}
