/**
 * SEO & ASO: page resolution, metadata injection, structured data, social share.
 */

export {
  getSEOPageConfig,
  getDefaultOgImagePath,
  type PageKey,
  type SEOPageConfig,
} from "./SEOPageResolver"

export {
  buildMetadata,
  mergeMetadata,
  type MetadataInput,
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

export { buildSeoMeta, type BuildSeoMetaInput } from "./meta"

export {
  getOgImageUrl,
  getSocialShareConfig,
  getTwitterShareUrl,
  getFacebookShareUrl,
  getLinkedInShareUrl,
  DEFAULT_OG_IMAGE_PATH,
  type SocialShareConfig,
} from "./SocialShareMetadataService"
