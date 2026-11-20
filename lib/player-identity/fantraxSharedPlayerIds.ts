import type { FantraxPlayerRef } from '@/lib/league-import/fantrax/fantraxApi'
import { getPlayersBySport, type SleeperPlayer } from '@/lib/sleeper-client'
import { prisma } from '@/lib/prisma'
import { normalizePlayerName } from '@/lib/team-abbrev'

function radarId(value: unknown): string {
  const key = String(value ?? '').trim().toLowerCase()
  return /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(key) && /[1-9a-f]/.test(key) ? key : ''
}

function wireId(value: unknown): string {
  const key = String(value ?? '').trim()
  return /^[1-9]\d*$/.test(key) ? key : ''
}

function indexUnique<T>(rows: T[], key: (row: T) => string): Map<string, T | null> {
  const index = new Map<string, T | null>()
  for (const row of rows) {
    const id = key(row)
    if (id) index.set(id, index.has(id) ? null : row)
  }
  return index
}

/** Both providers must identify the same unique Sleeper athlete through both shared ID namespaces. */
export function matchSharedFantraxPlayers(refs: FantraxPlayerRef[], players: SleeperPlayer[]) {
  const radar = indexUnique(players, p => radarId(p.sportradar_id))
  const wire = indexUnique(players, p => wireId(p.rotowire_id))
  const proposed = refs.flatMap(ref => {
    const player = radar.get(radarId(ref.sportRadarId))
    return player?.player_id && wire.get(wireId(ref.rotowireId)) === player
      ? [{ fantraxId: ref.fantraxId, player }] : []
  })
  const sources = indexUnique(proposed, row => row.fantraxId)
  const targets = indexUnique(proposed, row => row.player.player_id)
  return proposed.filter(row => sources.get(row.fantraxId) === row && targets.get(row.player.player_id) === row)
}

export async function linkSharedFantraxPlayers(sport: 'NBA' | 'NFL', refs: FantraxPlayerRef[]) {
  const supplied = refs.filter(r => radarId(r.sportRadarId) && wireId(r.rotowireId))
  if (!supplied.length) return
  const known = await prisma.playerIdentityMap.findMany({
    where: { sport, fantraxId: { in: supplied.map(r => r.fantraxId) } }, select: { fantraxId: true },
  })
  const linked = new Set(known.map(row => row.fantraxId))
  if (supplied.every(ref => linked.has(ref.fantraxId))) return
  const directory = await getPlayersBySport(sport.toLowerCase())
  const matches = matchSharedFantraxPlayers(supplied, Object.values(directory)).filter(row => !linked.has(row.fantraxId))
  if (!matches.length) return
  const ids = matches.map(m => m.player.player_id)
  const names = matches.map(m => normalizePlayerName(m.player.full_name || ''))
  const rows = await prisma.playerIdentityMap.findMany({
    where: sport === 'NFL' ? { sport, sleeperId: { in: ids } } : {
      sport, rollingInsightsId: { not: null }, OR: [{ sleeperNbaId: { in: ids } }, { normalizedName: { in: names } }],
    },
    select: { id: true, sleeperId: true, sleeperNbaId: true, normalizedName: true, dob: true, fantraxId: true },
  })
  const direct = indexUnique(rows, r => String((sport === 'NFL' ? r.sleeperId : r.sleeperNbaId) ?? ''))
  const birthdays = indexUnique(rows, r => r.dob && r.normalizedName ? r.normalizedName + '|' + r.dob.slice(0, 10) : '')
  const proposed = matches.flatMap(({ fantraxId, player }) => {
    const date = String(player.birth_date ?? '')
    const allowBirthday = sport === 'NBA' && /^\d{4}-\d{2}-\d{2}$/.test(date) && !direct.has(player.player_id)
    const row = allowBirthday ? birthdays.get(normalizePlayerName(player.full_name || '') + '|' + date) : direct.get(player.player_id)
    if (!row || row.fantraxId || (allowBirthday && row.sleeperNbaId)) return []
    return [{ id: row.id, fantraxId }]
  })
  const targets = indexUnique(proposed, link => link.id)
  const links = proposed.filter(link => targets.get(link.id) === link)
  if (!links.length) return
  await prisma.$executeRaw`
    WITH links AS (SELECT * FROM jsonb_to_recordset(${JSON.stringify(links)}::jsonb) AS l(id text, "fantraxId" text))
    UPDATE "PlayerIdentityMap" p SET "fantraxId" = l."fantraxId", "updatedAt"=NOW(), "lastSyncedAt"=NOW()
    FROM links l WHERE p.id=l.id AND p.sport=${sport} AND p."fantraxId" IS NULL
      AND NOT EXISTS (SELECT 1 FROM "PlayerIdentityMap" other WHERE other.sport=${sport} AND other."fantraxId"=l."fantraxId")
  `
}
