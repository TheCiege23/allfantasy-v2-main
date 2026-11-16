/** Version bump when the normalized contract or merge semantics change. */
export const SPORTS_DATA_NORMALIZATION_SCHEMA_VERSION = 1 as const

export const PIPELINE_ID = 'allfantasy-sports-data-normalization' as const

/** Priority order for merging real upstream rows (first wins for identity; projections merge by field). */
const SOURCE_PRIORITY = [
  'rolling_insights',
  'sports_db',
  'clear_sports',
  'api_sports',
  'thesportsdb',
  'espn',
  'sleeper',
] as const

export type UpstreamSourceTag = (typeof SOURCE_PRIORITY)[number] | string
