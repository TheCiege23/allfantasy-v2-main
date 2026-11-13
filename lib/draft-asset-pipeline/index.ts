/**
 * Draft Asset Pipeline — consistent player images, team logos, and stats for all draft types.
 * Supported: live, mock, auction, slow, keeper, devy, C2C.
 * Sports: NFL, NHL, NBA, MLB, NCAAB, NCAAF, SOCCER.
 */

export {
  resolveAssets,
  getTeamLogoUrl,
  normalizePlayer,
  normalizePlayerList,
} from './DraftAssetPipelineService'

export { getStatSnapshot, setStatSnapshot, clearStatSnapshotCache } from './stat-snapshot-cache'

export type {
  NormalizedDraftEntry,
  PlayerDisplayModel,
  PlayerAssetModel,
  TeamDisplayModel,
  PlayerStatSnapshotModel,
  PlayerDraftMetadataModel,
} from '@/lib/draft-sports-models/types'
export type { RawDraftPlayerLike } from '@/lib/draft-sports-models/normalize-draft-player'
