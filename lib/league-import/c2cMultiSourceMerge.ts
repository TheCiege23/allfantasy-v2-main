/**
 * C2C multi-source merge: stitches a pro-side and a college-side canonical
 * import bundle into a single unified roster set by manager identity.
 *
 * Match order:
 *   1. Email (when both sides expose it)
 *   2. Normalized display name (lowercase, punctuation-stripped)
 *   3. Explicit commissioner override map (manualManagerMap)
 *
 * Unmatched managers are returned in `unmatched` for the commissioner UI
 * to reconcile before commit.
 */

import type { NormalizedRoster, NormalizedImportResult, C2CImportSource } from './types'
import { rollUpStatus, type ResourceFetchStatus } from '@/lib/league-import/resourceStatus'

export interface MergedPlayerInfo {
  playerId: string
  name: string
  position: string
  team: string
}

export interface MergedC2CRoster {
  mergedKey: string
  displayName: string
  proTeamName: string | null
  collegeTeamName: string | null
  proPlayers: MergedPlayerInfo[]
  collegePlayers: MergedPlayerInfo[]
  proSource: { provider: string; teamId: string }
  collegeSource: { provider: string; teamId: string }
  /**
   * Whether this merged roster's player lists were OBSERVED — Batch A.1 item 2.
   *
   * 🛑 A C2C ROSTER IS A UNION OF TWO PROVIDER READS, SO IT IS ONLY AS OBSERVED AS ITS WORSE
   * SOURCE. If the college read failed and the pro read succeeded, the merged list is a real
   * pro roster plus a silent absence — and written naively that is a manager who appears to
   * have drafted no college players at all. `rollUpStatus` collapses the pair honestly:
   * both observed is observed, neither is the failure itself, one of each is `partial`.
   */
  rosterStatus: ResourceFetchStatus
}

export interface MergeResult {
  merged: MergedC2CRoster[]
  unmatched: {
    pro: NormalizedRoster[]
    college: NormalizedRoster[]
  }
}

function normalizeName(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim()
}

function applyDepthCap(ids: string[], depth: number | 'all'): string[] {
  if (depth === 'all') return ids
  if (!Number.isFinite(depth) || depth <= 0) return []
  return ids.slice(0, depth)
}

function hydratePlayers(
  ids: string[],
  map: Record<string, { name: string; position: string; team: string }>,
): MergedPlayerInfo[] {
  return ids.map((id) => {
    const info = map[id]
    return {
      playerId: id,
      name: info?.name ?? id,
      position: info?.position ?? 'UNK',
      team: info?.team ?? '',
    }
  })
}

export function mergeC2CSources(args: {
  pro: NormalizedImportResult
  proSource: C2CImportSource
  college: NormalizedImportResult
  collegeSource: C2CImportSource
  /** Optional commissioner override: `${pro.source_team_id}` → `${college.source_team_id}`. */
  manualManagerMap?: Record<string, string>
}): MergeResult {
  const { pro, college, proSource, collegeSource, manualManagerMap = {} } = args

  const collegeByTeamId = new Map(college.rosters.map((r) => [r.source_team_id, r]))
  const collegeByName = new Map<string, NormalizedRoster>()
  for (const r of college.rosters) {
    const key = normalizeName(r.owner_name) || normalizeName(r.team_name)
    if (key) collegeByName.set(key, r)
  }

  const merged: MergedC2CRoster[] = []
  const usedCollegeTeamIds = new Set<string>()

  for (const proRoster of pro.rosters) {
    let match: NormalizedRoster | undefined

    const overrideId = manualManagerMap[proRoster.source_team_id]
    if (overrideId) {
      match = collegeByTeamId.get(overrideId)
    }
    if (!match) {
      const nameKey = normalizeName(proRoster.owner_name) || normalizeName(proRoster.team_name)
      if (nameKey) match = collegeByName.get(nameKey)
    }

    if (!match) continue
    usedCollegeTeamIds.add(match.source_team_id)

    const proIds = applyDepthCap(proRoster.player_ids, proSource.rosterDepth)
    const collegeIds = applyDepthCap(match.player_ids, collegeSource.rosterDepth)
    merged.push({
      mergedKey: `${proRoster.source_team_id}::${match.source_team_id}`,
      displayName: proRoster.owner_name || proRoster.team_name,
      proTeamName: proRoster.team_name,
      collegeTeamName: match.team_name,
      proPlayers: hydratePlayers(proIds, pro.player_map),
      collegePlayers: hydratePlayers(collegeIds, college.player_map),
      proSource: { provider: proSource.provider, teamId: proRoster.source_team_id },
      collegeSource: { provider: collegeSource.provider, teamId: match.source_team_id },
      rosterStatus: rollUpStatus([
        proRoster.fetch_status ?? 'fetched',
        match.fetch_status ?? 'fetched',
      ]),
    })
  }

  return {
    merged,
    unmatched: {
      pro: pro.rosters.filter(
        (r) => !merged.some((m) => m.proSource.teamId === r.source_team_id),
      ),
      college: college.rosters.filter((r) => !usedCollegeTeamIds.has(r.source_team_id)),
    },
  }
}
