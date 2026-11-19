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
  currentAppearances?: readonly { playerId: string; team: string | null }[]
}) {
  const schoolByCode = new Map<string, Set<string>>()
  for (const team of args.teams) {
    const code = teamKey(team.shortName)
    if (!code) continue
    const names = schoolByCode.get(code) ?? new Set<string>()
    names.add(teamKey(team.name))
    schoolByCode.set(code, names)
  }

  // Match the school's registry name to the school actually recorded on a current game.
  const gameSchools = new Map<string, Set<string>>()
  for (const row of args.currentAppearances ?? []) {
    const schools = schoolByCode.get(teamKey(row.team))
    const claims = gameSchools.get(row.playerId) ?? new Set<string>()
    claims.add(schools?.size === 1 ? [...schools][0]! : '')
    gameSchools.set(row.playerId, claims)
  }
  const activeByName = new Map<string, NcaabIdentity[]>()
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
    if (!identity.rollingInsightsId || !identity.normalizedName ||
        !identity.currentTeam || !identity.position) continue
    const sources = sourceById.get(identity.rollingInsightsId)
    if (sources?.length !== 1) continue
    const source = sources[0]!
    if (normalizePlayerName(source.name) !== identity.normalizedName ||
        teamKey(source.team) !== teamKey(identity.currentTeam) ||
        source.position !== identity.position) continue
    const game = gameSchools.get(identity.id)
    if (game?.size === 1 && game.has(teamKey(identity.currentTeam))) {
      const rows = activeByName.get(identity.normalizedName) ?? []
      rows.push(identity)
      activeByName.set(identity.normalizedName, rows)
    }
    if (identity.fantraxId) continue
    const key = `${identity.normalizedName}|${teamKey(identity.currentTeam)}|${identity.position}`
    identityByKey.set(key, [...(identityByKey.get(key) ?? []), identity])
  }

  // A new abbreviation needs three distinct current players, unique names on both sides,
  // and no competing school. An existing ambiguous team code is never overwritten.
  const providerNames = new Map<string, number>()
  const providerIds = new Map<string, number>()
  for (const ref of args.refs) {
    const name = nameKey(ref.name)
    providerNames.set(name, (providerNames.get(name) ?? 0) + 1)
    providerIds.set(ref.fantraxId, (providerIds.get(ref.fantraxId) ?? 0) + 1)
  }
  const schoolVotes = new Map<string, Map<string, Set<string>>>()
  for (const ref of args.refs) {
    const code = teamKey(ref.team), name = nameKey(ref.name)
    if (!code || schoolByCode.has(code) || providerNames.get(name) !== 1 || providerIds.get(ref.fantraxId) !== 1) continue
    const matches = activeByName.get(name)
    if (matches?.length !== 1) continue
    const player = matches[0]!
    if (ref.position !== player.position || (player.fantraxId && player.fantraxId !== ref.fantraxId)) continue
    const school = teamKey(player.currentTeam), votes = schoolVotes.get(code) ?? new Map<string, Set<string>>()
    const voters = votes.get(school) ?? new Set<string>()
    voters.add(player.id)
    votes.set(school, voters)
    schoolVotes.set(code, votes)
  }
  const learned = new Map<string, string>()
  for (const [code, votes] of schoolVotes) {
    const [first] = votes
    if (votes.size === 1 && first && first[1].size >= 3) learned.set(code, first[0])
  }
  const candidates = new Map<string, NcaabIdentity[]>()
  const claims = new Map<string, Set<string>>()
  for (const ref of args.refs) {
    const code = teamKey(ref.team)
    const inferred = learned.get(code)
    const schools = inferred ? new Set([inferred]) : schoolByCode.get(code)
    if (schools?.size !== 1 || !ref.position || !ref.name) continue
    const key = `${nameKey(ref.name)}|${[...schools][0]}|${ref.position}`
    const matches = identityByKey.get(key) ?? []
    const eligible = inferred ? (activeByName.get(nameKey(ref.name)) ?? []).filter(
      p => teamKey(p.currentTeam) === inferred && p.position === ref.position,
    ) : null
    const rows = eligible ? (eligible.length === 1 && !eligible[0]!.fantraxId ? eligible : []) : matches
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
    if (rows.length !== 1 || providerIds.get(fantraxId) !== 1) {
      if (rows.length > 1 || (rows.length && providerIds.get(fantraxId) !== 1)) ambiguous++
      continue
    }
    const row = rows[0]!
    if (claims.get(row.id)?.size !== 1) { conflicts++; continue }
    links.push({ id: row.id, fantraxId, rollingInsightsId: row.rollingInsightsId! })
  }
  return { links, ambiguous, conflicts }
}
