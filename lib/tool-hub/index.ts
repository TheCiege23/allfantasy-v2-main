/**
 * Tool Hub — discovery, filtering, and cross-tool linking.
 */

export {
  getAllTools,
  getAllSports,
  getToolsInCategory,
  getToolsForSport,
} from './ToolHubService'

export { getToolCardDisplay, getToolCardsForSlugs } from './ToolCardResolver'

export { getRelatedTools } from './RelatedToolResolver'

export {
  getSportFilterOptions,
  getToolSlugsForSport,
} from './SportToolFilterResolver'

export {
  getFeaturedToolSlugs,
  getTrendingToolSlugs,
  getToolsByCategory,
  getCategoryForTool,
  getCategoryLabel,
  CATEGORY_ORDER,
} from './FeaturedToolResolver'

export {
  ROUTES,
  getOpenToolHref,
  getToolLandingPath,
  getToolsHubPathWithFilters,
  getBestToolForMeHref,
} from './ToolDiscoveryNavigationService'

export type { ToolCardDisplay, ToolCategoryId } from './types'
