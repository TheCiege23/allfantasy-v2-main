import { prisma } from '@/lib/prisma'
import { normalizePlayerName } from '@/lib/team-abbrev'
import { proTeamCode } from '@/lib/player-identity/proFantraxIdentityPlan'

type Provider = 'espn' | 'fleaflicker' | 'mfl' | 'fantrax'
type Identity = {
  id: string
  canonicalName: string
  position: string | null
  currentTeam: string | null
  espnId: string | null
  fleaflickerId: string | null
  mflId: string | null
  fantraxId: string | null
  cfbdId: string | null
}

const column: Record<Provider, keyof Pick<Identity, 'espnId' | 'fleaflickerId' | 'mflId' | 'fantraxId'>> = {
  espn: 'espnId', fleaflicker: 'fleaflickerId', mfl: 'mflId', fantrax: 'fantraxId',
}

/** An imported roster id is never a game-log id merely because its digits happen to match. */
export async function bridgeImportedGameLogIds(args: {
  provider: string
  sport: string
  rosterIds: readonly string[]
}): Promise<{ gameLogIds: string[]; rosterIdFor: (id: string) => string | undefined;
  metadata: Map<string, { name: string; position: string | null; team: string | null }>;
  unresolved: string[]; ambiguous: string[] }> {
  const ids = [...new Set(args.rosterIds.map((id) => id.trim()).filter(Boolean))]
  const field = column[args.provider.toLowerCase() as Provider]
  if (args.provider.toLowerCase() === 'sleeper' && args.sport.toUpperCase() === 'NBA') {
    return bridgeSleeperNbaIds(ids)
  }
  if (!field || !ids.length) return { gameLogIds: [], rosterIdFor: () => undefined,
    metadata: new Map(), unresolved: ids, ambiguous: [] }
  const sport = args.sport.toUpperCase()
  const rows: Identity[] = await prisma.playerIdentityMap.findMany({
    where: { sport, [field]: { in: ids } },
    select: { id: true, canonicalName: true, position: true, currentTeam: true,
      espnId: true, fleaflickerId: true, mflId: true, fantraxId: true, cfbdId: true },
  })
  const byRoster = new Map<string, Set<string>>()
  const byGameLog = new Map<string, Set<string>>()
  for (const row of rows) {
    const rosterId = row[field]
    const gameLogId = sport === 'NCAAF' ? row.cfbdId : row.id
    if (!rosterId || !gameLogId || !ids.includes(rosterId)) continue
    byRoster.set(rosterId, (byRoster.get(rosterId) ?? new Set()).add(gameLogId))
    byGameLog.set(gameLogId, (byGameLog.get(gameLogId) ?? new Set()).add(rosterId))
  }
  const mapping = new Map<string, string>()
  const metadata = new Map<string, { name: string; position: string | null; team: string | null }>()
  const ambiguous: string[] = []
  for (const id of ids) {
    const targets = [...(byRoster.get(id) ?? [])]
    if (targets.length > 1 || (targets.length === 1 && byGameLog.get(targets[0]!)!.size > 1)) {
      ambiguous.push(id)
    } else if (targets.length === 1) {
      mapping.set(targets[0]!, id)
      const identity = rows.find((row) => row[field] === id &&
        (sport === 'NCAAF' ? row.cfbdId : row.id) === targets[0])
      if (identity?.canonicalName) metadata.set(id, { name: identity.canonicalName,
        position: identity.position, team: identity.currentTeam })
    }
  }
  return { gameLogIds: [...mapping.keys()], rosterIdFor: (id) => mapping.get(id), metadata,
    unresolved: ids.filter((id) => !ambiguous.includes(id) && ![...mapping.values()].includes(id)), ambiguous }
}

function nbaNameKey(name: string): string {
  return normalizePlayerName(name.normalize('NFKD').replace(/\p{M}/gu, ''))
}

/** Resolve Sleeper's NBA ids via the provider catalog, never by their numeric value. */
async function bridgeSleeperNbaIds(ids: string[]) {
  const players = await prisma.sportsPlayer.findMany({
    where: { sport: 'NBA', source: 'sleeper', sleeperId: { in: ids } },
    select: { sleeperId: true, name: true, team: true, dob: true },
  })
  const names = [...new Set(players.flatMap((player) => [normalizePlayerName(player.name), nbaNameKey(player.name)]))]
  const candidates = await prisma.playerIdentityMap.findMany({
    where: { sport: 'NBA', normalizedName: { in: names }, rollingInsightsId: { not: null } },
    select: { id: true, normalizedName: true, canonicalName: true, position: true, currentTeam: true, dob: true },
  })

  const matches = new Map<string, (typeof candidates)[number]>()
  const ambiguous: string[] = []
  for (const id of ids) {
    const sources = players.filter((player) => player.sleeperId === id)
    if (sources.length > 1) {
      ambiguous.push(id)
      continue
    }
    const player = sources[0]
    if (!player) continue
    const name = nbaNameKey(player.name)
    const team = player.team ? proTeamCode('NBA', player.team) : null
    if (!name) continue
    const named = candidates.filter((candidate) => nbaNameKey(candidate.canonicalName) === name)
    const byTeam = team ? named.filter((candidate) => proTeamCode('NBA', candidate.currentTeam) === team) : []
    // A free agent or a player whose team changed can still be corroborated by birth date.
    const dob = player.dob?.trim()
    const byBirthDate = dob && /^\d{4}-\d{2}-\d{2}$/.test(dob)
      ? named.filter((candidate) => candidate.dob === dob)
      : []
    if (byTeam.length === 1 && byBirthDate.length === 1 && byTeam[0]!.id !== byBirthDate[0]!.id) {
      ambiguous.push(id)
      continue
    }
    const targets = byBirthDate.length === 1 ? byBirthDate : byTeam.length ? byTeam : byBirthDate
    if (targets.length > 1) ambiguous.push(id)
    if (targets.length === 1) matches.set(id, targets[0]!)
  }

  const mapping = new Map<string, string>()
  const metadata = new Map<string, { name: string; position: string | null; team: string | null }>()
  for (const [id, target] of matches) {
    if ([...matches.values()].filter((row) => row.id === target.id).length !== 1) {
      ambiguous.push(id)
      continue
    }
    mapping.set(target.id, id)
    metadata.set(id, { name: target.canonicalName, position: target.position, team: target.currentTeam })
  }

  return {
    gameLogIds: [...mapping.keys()],
    rosterIdFor: (id: string) => mapping.get(id),
    metadata,
    unresolved: ids.filter((id) => !metadata.has(id) && !ambiguous.includes(id)),
    ambiguous,
  }
}
