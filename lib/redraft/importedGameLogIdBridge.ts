import { prisma } from '@/lib/prisma'

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
