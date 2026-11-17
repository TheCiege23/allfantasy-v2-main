import { normalizePlayerName } from '@/lib/team-abbrev'

type NcaabFantraxRef = { fantraxId: string; name: string; team: string; position: string }
export type NcaabIdentity = {
  id: string
  normalizedName: string | null
  position: string | null
  currentTeam: string | null
  rollingInsightsId: string | null
  fantraxId: string | null
}
type NcaabSourcePlayer = { externalId: string; name: string; position: string | null; team: string | null }
type NcaabTeam = { name: string; shortName: string | null }

const teamKey = (value: string | null | undefined) => String(value ?? '').trim().toUpperCase()
const nameKey = (value: string) => {
  const parts = value.split(',')
  return normalizePlayerName(parts.length === 2 ? `${parts[1]} ${parts[0]}` : value)
}

/** Attach only rostered Fantrax IDs with one exact name, school, and position match. */
export function planNcaabFantraxIdentityLinks(args: {
  refs: readonly NcaabFantraxRef[]
  identities: readonly NcaabIdentity[]
  sourcePlayers: readonly NcaabSourcePlayer[]
  teams: readonly NcaabTeam[]
  rosterIds: ReadonlySet<string>
}) {
  const schoolByCode = new Map<string, Set<string>>()
  for (const team of args.teams) {
    const code = teamKey(team.shortName)
    if (!code) continue
    const names = schoolByCode.get(code) ?? new Set<string>()
    names.add(teamKey(team.name))
    schoolByCode.set(code, names)
  }

  const sourceById = new Map<string, NcaabSourcePlayer[]>()
  for (const player of args.sourcePlayers) {
    const rows = sourceById.get(player.externalId) ?? []
    rows.push(player)
    sourceById.set(player.externalId, rows)
  }
  const identityByKey = new Map<string, NcaabIdentity[]>()
  const ownedSourceIds = new Set<string>()
  for (const identity of args.identities) {
    if (identity.fantraxId) ownedSourceIds.add(identity.fantraxId)
    if (identity.fantraxId || !identity.rollingInsightsId || !identity.normalizedName ||
        !identity.currentTeam || !identity.position) continue
    const sources = sourceById.get(identity.rollingInsightsId)
    if (sources?.length !== 1) continue
    const source = sources[0]!
    if (normalizePlayerName(source.name) !== identity.normalizedName ||
        teamKey(source.team) !== teamKey(identity.currentTeam) ||
        source.position !== identity.position) continue
    const key = `${identity.normalizedName}|${teamKey(identity.currentTeam)}|${identity.position}`
    identityByKey.set(key, [...(identityByKey.get(key) ?? []), identity])
  }

  const sourceCounts = new Map<string, number>()
  const candidates = new Map<string, NcaabIdentity[]>()
  const claims = new Map<string, Set<string>>()
  for (const ref of args.refs) {
    sourceCounts.set(ref.fantraxId, (sourceCounts.get(ref.fantraxId) ?? 0) + 1)
    const schools = schoolByCode.get(teamKey(ref.team))
    if (schools?.size !== 1 || !ref.position || !ref.name) continue
    const key = `${nameKey(ref.name)}|${[...schools][0]}|${ref.position}`
    const rows = identityByKey.get(key) ?? []
    candidates.set(ref.fantraxId, rows)
    for (const row of rows) {
      const ids = claims.get(row.id) ?? new Set<string>()
      ids.add(ref.fantraxId)
      claims.set(row.id, ids)
    }
  }

  const links: Array<{ id: string; fantraxId: string; rollingInsightsId: string }> = []
  let ambiguous = 0
  let conflicts = 0
  for (const fantraxId of args.rosterIds) {
    if (ownedSourceIds.has(fantraxId)) continue
    const rows = candidates.get(fantraxId) ?? []
    if (rows.length !== 1 || sourceCounts.get(fantraxId) !== 1) {
      if (rows.length > 1 || (rows.length && sourceCounts.get(fantraxId) !== 1)) ambiguous++
      continue
    }
    const row = rows[0]!
    if (claims.get(row.id)?.size !== 1) { conflicts++; continue }
    links.push({ id: row.id, fantraxId, rollingInsightsId: row.rollingInsightsId! })
  }
  return { links, ambiguous, conflicts }
}
