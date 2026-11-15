import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import {
  SPORT_SLUGS,
  SPORT_CONFIG,
  getImportPlatformsForSport,
  getSportCanonical,
  type SportSlug,
} from '@/lib/seo-landing/config'
import { getLeagueTypeDemoMeta, getLeagueTypesForSport } from '@/lib/seo-landing/league-type-pages'
import SportLandingClient from './SportLandingClient'
import { buildMetadata } from '@/lib/seo'
import { getPublicSiteOrigin } from '@/lib/site-public-origin'

export async function generateStaticParams() {
  return SPORT_SLUGS.map((sport) => ({ sport }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ sport: string }>
}): Promise<Metadata> {
  const { sport } = await params
  const config = SPORT_CONFIG[sport as SportSlug]
  if (!config) {
    return buildMetadata({
      title: 'AllFantasy – Fantasy Sports Tools',
      description: 'AI-powered fantasy sports tools and league management.',
      canonical: `${getPublicSiteOrigin()}/tools-hub`,
    })
  }

  const canonical = getSportCanonical(config.slug)
  return buildMetadata({
    title: config.title,
    description: config.description,
    keywords: config.keywords,
    canonical,
  })
}

export default async function SportPage({
  params,
}: {
  params: Promise<{ sport: string }>
}) {
  const { sport } = await params
  if (!SPORT_SLUGS.includes(sport as SportSlug)) notFound()
  const config = SPORT_CONFIG[sport as SportSlug]
  // Computed here, on the server, from the create-league and importer configs, so the page can
  // only list league types and platforms those screens will accept for this sport.
  const leagueTypes = getLeagueTypesForSport(config.leagueSport).map((p) => ({
    slug: p.slug,
    name: p.name,
    subtitle: getLeagueTypeDemoMeta(p)?.subtitle ?? null,
  }))
  const importPlatforms = getImportPlatformsForSport(config.leagueSport)
  return <SportLandingClient config={config} leagueTypes={leagueTypes} importPlatforms={importPlatforms} />
}
