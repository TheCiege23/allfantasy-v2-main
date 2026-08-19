/**
 * Fantasy OS Phase 5D-c — cross-provider canonical team identity + certified mapping (Parts 1–3).
 *
 * Bridges Sleeper team abbreviations ↔ ESPN team ids/abbreviations ↔ one canonical team. Resolution is
 * evidence-based and fails closed: display name / city alone, or an abbreviation without sport, NEVER resolve.
 * Free-agent values are unresolved BY DESIGN (not an error). Aliases cover the real divergences (WAS↔WSH) and
 * relocated franchises (OAK→LV, SD→LAC, STL→LAR, JAC→JAX).
 */
export type CanonicalTeamIdentity = {
  canonicalTeamId: string
  sport: string
  league: string
  currentName: string
  currentAbbreviation: string
  city: string | null
  active: boolean
  providerIds: Record<string, string>
  aliases: string[]
  historicalAliases: Array<{ value: string; validFrom: string | null; validTo: string | null }>
}

export type TeamResolutionEvidence = { rule: string; provider: string; value: string }
export type TeamResolutionResult =
  | { status: 'resolved'; canonicalTeamId: string; evidence: TeamResolutionEvidence[] }
  | { status: 'ambiguous'; candidates: string[]; evidence: TeamResolutionEvidence[] }
  | { status: 'unresolved'; evidence: TeamResolutionEvidence[] }
  | { status: 'conflicting'; candidates: string[]; evidence: TeamResolutionEvidence[] }

// [espnId, canonicalAbbr, name, city, sleeperAbbrOverride?, historical?]
const NFL: Array<[string, string, string, string, string?, string[]?]> = [
  ['22', 'ARI', 'Cardinals', 'Arizona'], ['1', 'ATL', 'Falcons', 'Atlanta'], ['33', 'BAL', 'Ravens', 'Baltimore'],
  ['2', 'BUF', 'Bills', 'Buffalo'], ['29', 'CAR', 'Panthers', 'Carolina'], ['3', 'CHI', 'Bears', 'Chicago'],
  ['4', 'CIN', 'Bengals', 'Cincinnati'], ['5', 'CLE', 'Browns', 'Cleveland'], ['6', 'DAL', 'Cowboys', 'Dallas'],
  ['7', 'DEN', 'Broncos', 'Denver'], ['8', 'DET', 'Lions', 'Detroit'], ['9', 'GB', 'Packers', 'Green Bay'],
  ['34', 'HOU', 'Texans', 'Houston'], ['11', 'IND', 'Colts', 'Indianapolis'], ['30', 'JAX', 'Jaguars', 'Jacksonville', undefined, ['JAC']],
  ['12', 'KC', 'Chiefs', 'Kansas City'], ['13', 'LV', 'Raiders', 'Las Vegas', undefined, ['OAK']], ['24', 'LAC', 'Chargers', 'Los Angeles', undefined, ['SD']],
  ['14', 'LAR', 'Rams', 'Los Angeles', undefined, ['STL']], ['15', 'MIA', 'Dolphins', 'Miami'], ['16', 'MIN', 'Vikings', 'Minnesota'],
  ['17', 'NE', 'Patriots', 'New England'], ['18', 'NO', 'Saints', 'New Orleans'], ['19', 'NYG', 'Giants', 'New York'],
  ['20', 'NYJ', 'Jets', 'New York'], ['21', 'PHI', 'Eagles', 'Philadelphia'], ['23', 'PIT', 'Steelers', 'Pittsburgh'],
  ['25', 'SF', '49ers', 'San Francisco'], ['26', 'SEA', 'Seahawks', 'Seattle'], ['27', 'TB', 'Buccaneers', 'Tampa Bay'],
  ['10', 'TEN', 'Titans', 'Tennessee'], ['28', 'WAS', 'Commanders', 'Washington', 'WAS'], // ESPN abbr is WSH → alias
]

export const NFL_TEAMS: CanonicalTeamIdentity[] = NFL.map(([espnId, abbr, name, city, sleeperAbbr, historical]) => {
  const espnAbbr = espnId === '28' ? 'WSH' : abbr // Washington: ESPN uses WSH
  const sleeper = sleeperAbbr ?? abbr
  const aliases = [...new Set([abbr, espnAbbr, sleeper, ...(historical ?? [])])]
  return {
    canonicalTeamId: `nfl:${abbr}`,
    sport: 'NFL',
    league: 'NFL',
    currentName: name,
    currentAbbreviation: abbr,
    city,
    active: true,
    providerIds: { espn: espnId, sleeper },
    aliases,
    historicalAliases: (historical ?? []).map((v) => ({ value: v, validFrom: null, validTo: null })),
  }
})

const FREE_AGENT_VALUES = new Set(['', 'FA', 'NONE', 'NULL'])

/** Resolve a provider team reference (id or abbreviation) to a canonical team. Fails closed. */
export function resolveTeam(input: { provider: string; ref: string | null; sport: string }): TeamResolutionResult {
  if (input.sport.toUpperCase() !== 'NFL') return { status: 'unresolved', evidence: [{ rule: 'sport_unsupported', provider: input.provider, value: input.sport }] }
  const raw = (input.ref ?? '').trim()
  if (raw === '' || FREE_AGENT_VALUES.has(raw.toUpperCase())) {
    return { status: 'unresolved', evidence: [{ rule: 'free_agent_or_empty', provider: input.provider, value: raw }] }
  }
  const provider = input.provider.toLowerCase()

  // 1. Certified provider-id mapping (strongest).
  if (/^\d+$/.test(raw)) {
    const byId = NFL_TEAMS.filter((t) => t.providerIds[provider] === raw)
    if (byId.length === 1) return { status: 'resolved', canonicalTeamId: byId[0].canonicalTeamId, evidence: [{ rule: 'certified_provider_id', provider, value: raw }] }
    if (byId.length > 1) return { status: 'conflicting', candidates: byId.map((t) => t.canonicalTeamId), evidence: [{ rule: 'provider_id_conflict', provider, value: raw }] }
  }

  // 2/3. Abbreviation (+ sport). Match the provider's own abbr, then aliases.
  const up = raw.toUpperCase()
  const byProviderAbbr = NFL_TEAMS.filter((t) => (t.providerIds[provider] ?? '').toUpperCase() === up)
  if (byProviderAbbr.length === 1) return { status: 'resolved', canonicalTeamId: byProviderAbbr[0].canonicalTeamId, evidence: [{ rule: 'verified_provider_abbreviation', provider, value: up }] }
  const byAlias = NFL_TEAMS.filter((t) => t.aliases.map((a) => a.toUpperCase()).includes(up))
  if (byAlias.length === 1) return { status: 'resolved', canonicalTeamId: byAlias[0].canonicalTeamId, evidence: [{ rule: 'verified_alias', provider, value: up }] }
  if (byAlias.length > 1) return { status: 'ambiguous', candidates: byAlias.map((t) => t.canonicalTeamId), evidence: [{ rule: 'alias_ambiguous', provider, value: up }] }

  return { status: 'unresolved', evidence: [{ rule: 'no_match', provider, value: up }] }
}

export type TeamMappingCertification = {
  version: string
  sport: string
  providerCoverage: Record<string, number>
  resolvedCount: number
  unresolvedCount: number
  ambiguousCount: number
  conflictingCount: number
  checksum: string
  certified: boolean
  limitations: string[]
}

/** Certify the NFL team mapping: 32 active, no duplicate active abbr, no provider id → multiple teams. */
export function certifyNflTeamMapping(): TeamMappingCertification {
  const active = NFL_TEAMS.filter((t) => t.active)
  const limitations: string[] = []
  const abbrs = new Set<string>()
  let dupAbbr = 0
  for (const t of active) { if (abbrs.has(t.currentAbbreviation)) dupAbbr++; abbrs.add(t.currentAbbreviation) }
  if (dupAbbr > 0) limitations.push(`${dupAbbr} duplicate active abbreviations`)
  // no provider id maps to multiple active teams
  const espnIds = active.map((t) => t.providerIds.espn)
  const dupEspn = espnIds.length - new Set(espnIds).size
  if (dupEspn > 0) limitations.push(`${dupEspn} ESPN ids map to multiple teams`)
  if (active.length !== 32) limitations.push(`expected 32 active NFL teams, found ${active.length}`)

  const body = active.map((t) => `${t.canonicalTeamId}|${t.providerIds.espn}|${t.providerIds.sleeper}|${[...t.aliases].sort().join(',')}`).sort().join(';')
  const checksum = fnv(body)
  return {
    version: 'nfl-team-map.v1',
    sport: 'NFL',
    providerCoverage: { espn: active.filter((t) => t.providerIds.espn).length, sleeper: active.filter((t) => t.providerIds.sleeper).length },
    resolvedCount: active.length,
    unresolvedCount: 0,
    ambiguousCount: 0,
    conflictingCount: 0,
    checksum,
    certified: limitations.length === 0,
    limitations,
  }
}

function fnv(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return (h >>> 0).toString(16)
}
