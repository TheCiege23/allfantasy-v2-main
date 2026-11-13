/**
 * Commissioner edits from the review screen, applied at commit.
 *
 * The commit route re-fetches and re-normalizes the league rather than trusting the preview, so
 * edits travel as a small, validated overlay keyed on SOURCE ids and are applied to the fresh
 * normalized result. An edit naming a team or player the fresh fetch does not contain is dropped,
 * never invented.
 */

import type { NormalizedImportResult } from '@/lib/league-import/types'
import type { ImportReviewOverrides } from './types'

const MAX_NAME = 80
const MAX_ENTRIES = 512

function cleanName(v: unknown): string | null {
  if (typeof v !== 'string') return null
  // Collapse whitespace and strip control characters; names are display text only.
  const s = v.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim()
  if (!s) return null
  return s.slice(0, MAX_NAME)
}

function cleanStringMap(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out: Record<string, string> = {}
  let n = 0
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (n >= MAX_ENTRIES) break
    const key = String(k).slice(0, 128)
    const name = cleanName(v)
    if (key && name) {
      out[key] = name
      n++
    }
  }
  return Object.keys(out).length ? out : undefined
}

/** Parse untrusted request JSON into overrides. Anything malformed is ignored, not rejected. */
export function parseImportReviewOverrides(raw: unknown): ImportReviewOverrides | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const teamNames = cleanStringMap(r.teamNames)
  const ownerNames = cleanStringMap(r.ownerNames)
  let playerMatches: ImportReviewOverrides['playerMatches']
  if (r.playerMatches && typeof r.playerMatches === 'object' && !Array.isArray(r.playerMatches)) {
    const pm: NonNullable<ImportReviewOverrides['playerMatches']> = {}
    let n = 0
    for (const [k, v] of Object.entries(r.playerMatches as Record<string, unknown>)) {
      if (n >= MAX_ENTRIES) break
      if (!v || typeof v !== 'object') continue
      const vv = v as Record<string, unknown>
      const afPlayerId = typeof vv.afPlayerId === 'string' ? vv.afPlayerId.trim().slice(0, 128) : ''
      const name = cleanName(vv.name)
      if (!afPlayerId || !name) continue
      pm[String(k).slice(0, 128)] = {
        afPlayerId,
        name,
        position: typeof vv.position === 'string' ? vv.position.slice(0, 16) : null,
        team: typeof vv.team === 'string' ? vv.team.slice(0, 16) : null,
      }
      n++
    }
    if (Object.keys(pm).length) playerMatches = pm
  }
  if (!teamNames && !ownerNames && !playerMatches) return null
  return { teamNames, ownerNames, playerMatches }
}

/**
 * Apply overrides to a freshly normalized result. Returns a new object; the input is not mutated.
 *
 * Player matches are recorded on the player's identity mapping (`af_id`) and in
 * `league.import_review` so they are auditable and survive into `League.settings`.
 */
export function applyImportReviewOverrides(
  normalized: NormalizedImportResult,
  overrides: ImportReviewOverrides | null,
): NormalizedImportResult {
  if (!overrides) return normalized
  const teamIds = new Set(normalized.rosters.map((r) => r.source_team_id))
  const rosters = normalized.rosters.map((r) => {
    const teamName = overrides.teamNames?.[r.source_team_id]
    const ownerName = overrides.ownerNames?.[r.source_team_id]
    if (!teamName && !ownerName) return r
    return {
      ...r,
      ...(teamName ? { team_name: teamName } : {}),
      ...(ownerName ? { owner_name: ownerName } : {}),
    }
  })

  const knownPlayers = new Set(Object.keys(normalized.player_map ?? {}))
  const appliedMatches: Record<string, { afPlayerId: string; name: string }> = {}
  for (const [id, m] of Object.entries(overrides.playerMatches ?? {})) {
    if (knownPlayers.has(id)) appliedMatches[id] = { afPlayerId: m.afPlayerId, name: m.name }
  }

  let identity_mappings = normalized.identity_mappings
  if (Object.keys(appliedMatches).length > 0) {
    const seen = new Set<string>()
    identity_mappings = (normalized.identity_mappings ?? []).map((mapping) => {
      if (mapping.entity_type !== 'player') return mapping
      const match = appliedMatches[mapping.source_id]
      if (!match) return mapping
      seen.add(mapping.source_id)
      return { ...mapping, af_id: match.afPlayerId }
    })
    for (const [id, match] of Object.entries(appliedMatches)) {
      if (seen.has(id)) continue
      identity_mappings.push({
        source_provider: normalized.source.source_provider,
        source_id: id,
        entity_type: 'player',
        af_id: match.afPlayerId,
      })
    }
  }

  const appliedTeamNames = Object.fromEntries(
    Object.entries(overrides.teamNames ?? {}).filter(([id]) => teamIds.has(id)),
  )
  const appliedOwnerNames = Object.fromEntries(
    Object.entries(overrides.ownerNames ?? {}).filter(([id]) => teamIds.has(id)),
  )

  return {
    ...normalized,
    rosters,
    identity_mappings,
    league: {
      ...normalized.league,
      import_review: {
        appliedAt: new Date().toISOString(),
        teamNames: appliedTeamNames,
        ownerNames: appliedOwnerNames,
        playerMatches: appliedMatches,
      },
    },
  }
}
