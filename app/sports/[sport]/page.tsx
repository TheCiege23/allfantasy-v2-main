import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import {
  SPORT_SLUGS,
  SPORT_CONFIG,
  getSportCanonical,
  type SportSlug,
} from '@/lib/seo-landing/config'
import SportLandingClient from './SportLandingClient'
import { buildMetadata } from '@/lib/seo'
import { getPublicSiteOrigin } from "@/lib/site-public-origin"

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
  return <SportLandingClient config={config} />
}
