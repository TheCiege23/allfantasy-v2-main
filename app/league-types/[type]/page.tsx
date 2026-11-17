import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import LeagueTypeLanding from '@/components/seo/LeagueTypeLanding'
import { buildSeoMeta } from '@/lib/seo'
import {
  LEAGUE_TYPE_SLUGS,
  getLeagueTypeCanonical,
  getLeagueTypeDemoMeta,
  getLeagueTypePage,
} from '@/lib/seo-landing/league-type-pages'

export const dynamicParams = false

export function generateStaticParams() {
  return LEAGUE_TYPE_SLUGS.map((type) => ({ type }))
}

type Params = { params: Promise<{ type: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const page = getLeagueTypePage((await params).type)
  if (!page) return {}
  return buildSeoMeta({
    title: page.title,
    description: page.description,
    canonical: getLeagueTypeCanonical(page.slug),
    imagePath: getLeagueTypeDemoMeta(page)?.poster ?? null,
  })
}

export default async function LeagueTypePage({ params }: Params) {
  const page = getLeagueTypePage((await params).type)
  if (!page) notFound()

  // Breadcrumbs are one of the few structured-data types Google still shows in results.
  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'League types', item: getLeagueTypeCanonical() },
      { '@type': 'ListItem', position: 2, name: page.name, item: getLeagueTypeCanonical(page.slug) },
    ],
  }

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} />
      <LeagueTypeLanding page={page} />
    </>
  )
}
