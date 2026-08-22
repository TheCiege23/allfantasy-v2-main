/**
 * Lineup OS — maintained fact state for `manager.lineup.set`.
 *
 * ⚠ Points the OPPOSITE way from `lib/commissioner-os`. Those are consumers: their
 * `decision-os-client` modules call INTO Decision OS to render a surface. This FEEDS Decision OS.
 * Same suffix, opposite arrow.
 */
export {
  createLineupOsStore,
  lineupOsScope,
  LINEUP_OS_TTL_MS,
  type LineupOsStore,
  type LineupOsEntry,
  type LineupOsFactKind,
} from './store'
export {
  createLineupOsLoaders,
  refreshLineupOsLeague,
  type LineupOsLoaders,
  type LineupOsOutcome,
  type LineupOsDeps,
  type LineupOsRefreshResult,
} from './readThrough'
