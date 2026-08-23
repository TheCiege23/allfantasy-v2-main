import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import {
  TOOL_SLUGS,
  TOOL_CONFIG,
  getToolCanonical,
  type ToolSlug,
} from '@/lib/seo-landing/config'
import { ToolPageJsonLd } from '@/components/seo/JsonLd'
import ToolLandingClient from './ToolLandingClient'
import { buildMetadata } from '@/lib/seo'
import { getPublicSiteOrigin } from "@/lib/site-public-origin"

export async function generateStaticParams() {
  return TOOL_SLUGS.map((tool) => ({ tool }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tool: string }>
}): Promise<Metadata> {
  const { tool } = await params
  const config = TOOL_CONFIG[tool as ToolSlug]
  if (!config) {
    return buildMetadata({
      title: 'AllFantasy – Fantasy Sports Tools',
      description: 'AI-powered fantasy sports tools and league management.',
      canonical: `${getPublicSiteOrigin()}/tools-hub`,
    })
  }

  const canonical = getToolCanonical(config.slug)
  return buildMetadata({
    title: config.title,
    description: config.description,
    keywords: config.keywords,
    canonical,
  })
}

export default async function ToolPage({
  params,
}: {
  params: Promise<{ tool: string }>
}) {
  const { tool } = await params
  if (!TOOL_SLUGS.includes(tool as ToolSlug)) notFound()
  const config = TOOL_CONFIG[tool as ToolSlug]
  return (
    <>
      <ToolPageJsonLd config={config} />
      <ToolLandingClient config={config} />
    </>
  )
}
