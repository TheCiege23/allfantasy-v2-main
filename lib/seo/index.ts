/**
 * SEO & ASO: page resolution, metadata injection, structured data, social share.
 */

export {
  getSEOPageConfig,
  getDefaultOgImagePath,
  type SEOPageConfig,
} from "./SEOPageResolver"

export {
  buildMetadata,
  mergeMetadata,
} from "./MetadataInjectionService"

export {
  getWebSiteSchema,
  getSoftwareApplicationSchema,
  getFAQPageSchema,
  getOrganizationSchema,
  getWebPageSchema,
  buildStructuredDataScript,
  type WebSiteSchema,
  type SoftwareApplicationSchema,
  type FAQPageSchema,
  type OrganizationSchema,
  type WebPageSchema,
} from "./StructuredDataResolver"

export { buildSeoMeta } from "./meta"

export {
  getOgImageUrl,
  getSocialShareConfig,
  getTwitterShareUrl,
  getFacebookShareUrl,
  getLinkedInShareUrl,
} from "./SocialShareMetadataService"
