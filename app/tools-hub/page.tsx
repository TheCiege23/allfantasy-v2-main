import type { Metadata } from 'next'
import {
  TOOLS_HUB_TITLE,
  TOOLS_HUB_DESCRIPTION,
} from '@/lib/seo-landing/config'
import { getAllSports, getAllTools } from '@/lib/tool-hub'
import ToolsHubClient from './ToolsHubClient'
import { buildMetadata } from '@/lib/seo'
import { getPublicSiteOrigin } from '@/lib/site-public-origin'
import { PageJsonLd } from '@/components/seo/JsonLd'
import { getToolCanonical, getSportCanonical } from '@/lib/seo-landing/config'

export const metadata: Metadata = buildMetadata({
  title: TOOLS_HUB_TITLE,
  description: TOOLS_HUB_DESCRIPTION,
  canonical: `${getPublicSiteOrigin()}/tools-hub`,
})

export default function ToolsHubPage() {
  const allSports = getAllSports()
  const allTools = getAllTools()
  const sports = allSports.map((sport) => ({ slug: sport.slug, headline: sport.headline }))
  const tools = allTools.map((tool) => ({
    slug: tool.slug,
    headline: tool.headline,
    openToolHref: tool.openToolHref,
  }))

  /*
   * ⚠ THE HUB EMITTED NO PAGE-LEVEL STRUCTURED DATA AT ALL. Its only JSON-LD was
   * the site-wide WebSite/Organization pair from the root layout — measured on
   * the rendered page, the single script was `json-ld-website` and there was no
   * `json-ld-page`. Meanwhile /pricing declares FAQPage and Product, every
   * /sports page declares WebPage, and /[sport]/leagues declares three blocks.
   * The hub was the one page in the SEO set describing nothing about itself.
   *
   * That matters more here than on a content page: this page IS a curated index
   * of 14 tools and 7 sports, and an index with no ItemList is exactly the shape
   * a crawler cannot infer. It is the same gap 5b1e41b0 closed on /pricing,
   * which rendered four FAQs and four priced plans and declared neither.
   *
   * ⚠ BOTH LISTS ARE DERIVED FROM THE SAME ARRAYS THE PAGE RENDERS, and the URLs
   * come from the shared canonical helpers rather than being rebuilt here. A
   * hand-written ItemList would be a fifth place for this catalogue to drift, and
   * this audit has already found the tool list disagreeing with itself twice.
   */
  const collectionSchema = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: TOOLS_HUB_TITLE,
    description: TOOLS_HUB_DESCRIPTION,
    url: `${getPublicSiteOrigin()}/tools-hub`,
    mainEntity: {
      '@type': 'ItemList',
      name: 'AllFantasy fantasy sports tools',
      numberOfItems: allTools.length,
      itemListElement: allTools.map((tool, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: tool.headline,
        url: getToolCanonical(tool.slug),
      })),
    },
  }
  const sportsSchema = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'AllFantasy sports coverage',
    numberOfItems: allSports.length,
    itemListElement: allSports.map((sport, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: sport.headline,
      url: getSportCanonical(sport.slug),
    })),
  }

  return (
    <>
      <PageJsonLd schemas={[collectionSchema, sportsSchema]} />
      <ToolsHubClient sports={sports} tools={tools} />
    </>
  )
}
