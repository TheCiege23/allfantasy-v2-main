/**
 * Client-side model for the Devy import wizard: the shapes the /api/devy/import routes return, the
 * pre-merge preview, and Spanish/English rendering of the English strings the merge engine writes.
 * Pure — no fetch, no React — so it is tested directly.
 */
import { managerBlocksMerge, mergeablePlayer } from '@/lib/devy/importMergeRules'

export type ImportSessionRow = {
  id: string
  leagueId?: string
  status: string
  mergedAt: string | null
  createdAt?: string
  summary?: unknown
}

export type ImportSourceSummary = {
  id: string
  sourceType: string
  sourcePlatform: string | null
  classification: string | null
  connectionStatus: string
  importedAt: string | null
  createdAt: string
  playerCount: number
  managerCount: number
  season: number | null
  hasError: boolean
}

export type PlayerMappingRow = {
  id: string
  externalId: string
  externalName: string
  externalPlatform: string
  externalPosition: string | null
  externalTeam: string | null
  externalSchool: string | null
  internalPlayerId: string | null
  internalPlayerName: string | null
  matchConfidence: string
  matchMethod: string | null
  isConfirmedByCommissioner: boolean
  requiresReview: boolean
  playerType: string | null
}

export type ManagerMappingRow = {
  id: string
  externalUsername: string
  externalDisplayName: string
  externalPlatform: string
  internalUserId: string | null
  internalUsername: string | null
  matchConfidence: string
  isConfirmedByCommissioner: boolean
  requiresReview: boolean
}

export type MergeConflictRow = {
  id: string
  conflictType: string
  description: string
  resolution: string
  commissionerNote?: string | null
}

export type LeagueManagerOption = { userId: string; label: string }

export type MatchPayload = {
  players: PlayerMappingRow[]
  managers: ManagerMappingRow[]
  conflicts: MergeConflictRow[]
  leagueManagers?: LeagueManagerOption[]
}

/** Wizard step to open for a session, from where its status says it stopped. */
export function stepForStatus(status: string | null | undefined): number {
  switch (status) {
    case 'matching':
      return 1
    case 'conflict_review':
      return 2
    case 'approved':
      return 3
    case 'merged':
      return 4
    default:
      return 0
  }
}

export const CONFIDENCE_ORDER = ['exact', 'high', 'medium', 'low', 'unmatched'] as const

export function isPlayerMergeable(p: PlayerMappingRow): boolean {
  return Boolean(p.internalPlayerId) && mergeablePlayer(p.isConfirmedByCommissioner, p.matchConfidence, p.requiresReview)
}

export function countByConfidence(players: PlayerMappingRow[]): Record<string, number> {
  const out: Record<string, number> = { exact: 0, high: 0, medium: 0, low: 0, unmatched: 0 }
  for (const p of players) {
    const raw = p.internalPlayerId ? p.matchConfidence : 'unmatched'
    const k = raw in out ? raw : 'unmatched'
    out[k] = (out[k] ?? 0) + 1
  }
  return out
}

export type MergePreview = {
  nflPlayers: number
  devyPlayers: number
  skippedPlayers: number
  needsConfirmation: number
  unmatchedPlayers: number
  managersLinked: number
  managersUnlinked: number
  blockingManagers: number
  pendingConflicts: number
  historySeasons: number[]
  canMerge: boolean
}

export function buildMergePreview(
  players: PlayerMappingRow[],
  managers: ManagerMappingRow[],
  conflicts: MergeConflictRow[],
  sources: ImportSourceSummary[],
): MergePreview {
  let nflPlayers = 0
  let devyPlayers = 0
  let needsConfirmation = 0
  let unmatchedPlayers = 0
  for (const p of players) {
    if (isPlayerMergeable(p)) {
      if (p.playerType === 'devy') devyPlayers++
      else nflPlayers++
    } else if (p.internalPlayerId) {
      needsConfirmation++
    } else {
      unmatchedPlayers++
    }
  }
  const blockingManagers = managers.filter(m => managerBlocksMerge(m.requiresReview, m.internalUserId)).length
  const pendingConflicts = conflicts.filter(c => c.resolution === 'pending').length
  const historySeasons = [...new Set(sources.map(s => s.season).filter((s): s is number => typeof s === 'number'))].sort(
    (a, b) => a - b,
  )
  return {
    nflPlayers,
    devyPlayers,
    skippedPlayers: needsConfirmation + unmatchedPlayers,
    needsConfirmation,
    unmatchedPlayers,
    managersLinked: managers.filter(m => Boolean(m.internalUserId)).length,
    managersUnlinked: managers.filter(m => !m.internalUserId).length,
    blockingManagers,
    pendingConflicts,
    historySeasons,
    canMerge: pendingConflicts === 0 && blockingManagers === 0 && nflPlayers + devyPlayers + historySeasons.length > 0,
  }
}

type Translate = (key: string, vars?: Record<string, string | number>) => string

/** The merge engine reports in English. Render the messages it is known to write in the viewer's
 *  language; anything else passes through untouched rather than being guessed at. */
export function localizeMergeMessage(msg: string, tr: Translate): string {
  let m: RegExpMatchArray | null
  if ((m = msg.match(/^(\d+) conflicts still pending$/))) return tr('devyImport.mergeError.conflictsPending', { count: m[1]! })
  if (msg === 'Unmatched managers require review') return tr('devyImport.mergeError.managersUnmatched')
  if (msg.startsWith('DevyLeague row missing')) return tr('devyImport.mergeError.noDevyConfig')
  if (msg.startsWith('No RedraftSeason for league')) return tr('devyImport.mergeError.noSeason')
  if (msg === 'Session not found') return tr('devyImport.mergeError.sessionNotFound')
  if ((m = msg.match(/^No manager mapping for (.+) \(external roster owner (.+)\)$/))) {
    return tr('devyImport.mergeError.noManager', { player: m[1]!, owner: m[2] === 'unknown' ? '—' : m[2]! })
  }
  if ((m = msg.match(/^No redraft roster for owner (.+)$/))) return tr('devyImport.mergeError.noRoster', { owner: m[1]! })
  if (msg === 'Some players could not be matched automatically.') return tr('devyImport.audit.note.unmatchedPlayers')
  if (msg === 'Some managers need manual linking.') return tr('devyImport.audit.note.unmatchedManagers')
  return msg
}

const KNOWN_CONFLICT_TYPES = [
  'duplicate_player',
  'graduated_devy_on_nfl_roster',
  'username_mismatch',
  'conflicting_picks',
  'player_on_two_rosters',
]

/** Translation-key segment for a conflict type's label and hint; unknown types share a fallback. */
export function conflictTypeKey(type: string): string {
  return KNOWN_CONFLICT_TYPES.includes(type) ? type : 'other'
}
