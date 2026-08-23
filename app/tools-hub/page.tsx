import type { Metadata } from 'next'
import {
  TOOLS_HUB_TITLE,
  TOOLS_HUB_DESCRIPTION,
} from '@/lib/seo-landing/config'
import { getAllSports, getAllTools } from '@/lib/tool-hub'
import ToolsHubClient from './ToolsHubClient'
import { buildMetadata } from '@/lib/seo'
import { getPublicSiteOrigin } from '@/lib/site-public-origin'

export const metadata: Metadata = buildMetadata({
  title: TOOLS_HUB_TITLE,
  description: TOOLS_HUB_DESCRIPTION,
  canonical: `${getPublicSiteOrigin()}/tools-hub`,
})

export default function ToolsHubPage() {
  const sports = getAllSports().map((sport) => ({ slug: sport.slug, headline: sport.headline }))
  const tools = getAllTools().map((tool) => ({
    slug: tool.slug,
    headline: tool.headline,
    openToolHref: tool.openToolHref,
  }))
  return <ToolsHubClient sports={sports} tools={tools} />
}
