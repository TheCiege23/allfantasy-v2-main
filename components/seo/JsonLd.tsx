import {
  getWebSiteSchema,
  getOrganizationSchema,
  getSoftwareApplicationSchema,
  getFAQPageSchema,
  getWebPageSchema,
  buildStructuredDataScript,
} from "@/lib/seo"
import type { ToolConfig } from "@/lib/seo-landing/config"
import { getToolCanonical } from "@/lib/seo-landing/config"

/** Injects WebSite + Organization JSON-LD into the page. */
export function DefaultJsonLd() {
  const schemas = [getWebSiteSchema(), getOrganizationSchema()]
  const json = buildStructuredDataScript(schemas)
  return (
    <script
      id="json-ld-website"
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: json }}
    />
  )
}

/** Tool landing page: SoftwareApplication + optional FAQPage. */
export function ToolPageJsonLd({ config }: { config: ToolConfig }) {
  const url = getToolCanonical(config.slug)
  const schemas: object[] = [
    getSoftwareApplicationSchema({
      name: config.headline,
      description: config.description,
      url,
      applicationCategory: "GameApplication",
      /*
       * Several of these tools ARE gated. feature-monetization-matrix.ts puts
       * ai_waivers (/waiver-ai), ai_chat (/chimmy), create_league
       * (/trade-analyzer, /trade-evaluator) and planning_tools (/af-legacy)
       * behind requiredPlanId "pro" with a token fallback. Measured before this
       * change: /tools/waiver-wire-advisor, /tools/trade-analyzer and
       * /tools/ai-draft-assistant each emitted "price":"0". Saying nothing is
       * correct here; the honest price depends on the visitor's plan.
       */
      offers: false,
    }),
  ]
  if (config.faqs?.length) {
    schemas.push(getFAQPageSchema(config.faqs))
  }
  const json = buildStructuredDataScript(schemas)
  return (
    <script
      id="json-ld-tool"
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: json }}
    />
  )
}

/** Page-level JSON-LD (e.g. WebPage). Pass one or more schema objects. PROMPT 168. */
export function PageJsonLd({ schemas }: { schemas: object | object[] }) {
  const json = buildStructuredDataScript(schemas)
  return (
    <script
      id="json-ld-page"
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: json }}
    />
  )
}

export { getWebPageSchema }
