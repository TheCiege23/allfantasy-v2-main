/**
 * Position-limit enforcement against the database: resolve player positions, then apply the pure
 * rule in lib/league/positionLimits.ts. One function — `positionLimitRefusal` — is called by every
 * door a player joins a team through (free-agent add and claim submission, overnight claim
 * processing, trades), so the rule cannot drift between them.
 *
 * Positions, cheapest and most league-specific first:
 *   1. `RedraftRosterPlayer` rows on the league's own rosters (what scoring uses);
 *   2. the position stored on the league's lineup rows (`playerData.lineup_sections`);
 *   3. a self-describing id (`name:Josh Allen:QB:BUF`);
 *   4. `SportsPlayer` by id, external id or Sleeper id, then `PlayerIdentityMap` by Sleeper id.
 * An id none of them knows is left out of the count (see the note in positionLimits.ts).
 */
import 'server-only'
import { prisma } from '@/lib/prisma'
import { getNormalizedLineupSections, type RosterSectionKey } from '@/lib/roster/LineupTemplateValidation'
import {
  normalizeLimitPosition,
  positionLimitBreaches,
  positionLimitMessage,
  readPositionLimits,
} from '@/lib/league/positionLimits'

function usable(position: unknown): string | null {
  const p = normalizeLimitPosition(position)
  return p && p !== 'UTIL' && p !== 'UNK' && p !== '—' ? p : null
}

export async function resolvePlayerPositions(input: {
  leagueId: string
  sport: string
  playerIds: string[]
}): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const want = [...new Set(input.playerIds.filter(Boolean))]
  const missing = () => want.filter((id) => !out.has(id))
  if (want.length === 0) return out

  const rosters = await prisma.roster.findMany({
    where: { leagueId: input.leagueId },
    select: { playerData: true, redraftRosterId: true },
  })
  const redraftIds = rosters.map((r) => r.redraftRosterId).filter((x): x is string => Boolean(x))
  if (redraftIds.length > 0) {
    const rows = await prisma.redraftRosterPlayer.findMany({
      where: { rosterId: { in: redraftIds }, playerId: { in: want }, droppedAt: null },
      select: { playerId: true, position: true },
    })
    for (const r of rows) {
      const p = usable(r.position)
      if (p && !out.has(r.playerId)) out.set(r.playerId, p)
    }
  }

  for (const r of rosters) {
    const sections = getNormalizedLineupSections(r.playerData)
    for (const k of Object.keys(sections) as RosterSectionKey[]) {
      for (const row of sections[k]) {
        const id = String(row.id ?? '')
        const p = usable(row.position)
        if (p && want.includes(id) && !out.has(id)) out.set(id, p)
      }
    }
  }

  for (const id of missing()) {
    const m = /^name:[^:]+:([A-Za-z/]{1,6}):/.exec(id)
    const p = m ? usable(m[1]) : null
    if (p) out.set(id, p)
  }

  let left = missing()
  if (left.length > 0) {
    const sport = String(input.sport || 'NFL').toUpperCase()
    const rows = await prisma.sportsPlayer.findMany({
      where: { sport, OR: [{ id: { in: left } }, { externalId: { in: left } }, { sleeperId: { in: left } }] },
      select: { id: true, externalId: true, sleeperId: true, position: true },
    })
    for (const r of rows) {
      const p = usable(r.position)
      if (!p) continue
      for (const key of [r.id, r.externalId, r.sleeperId]) if (key && left.includes(key) && !out.has(key)) out.set(key, p)
    }
    left = missing()
    if (left.length > 0) {
      const ids = await prisma.playerIdentityMap.findMany({
        where: { sport, sleeperId: { in: left } },
        select: { sleeperId: true, position: true },
      })
      for (const r of ids) {
        const p = usable(r.position)
        if (p && r.sleeperId && !out.has(r.sleeperId)) out.set(r.sleeperId, p)
      }
    }
  }
  return out
}

export type RosterChange = { rosterId: string; before: string[]; after: string[]; teamLabel?: string }

/**
 * The refusal message when any team in this move goes over a position limit, or null. Reads the
 * league's limits first and does no position lookup at all when there are none.
 */
export async function positionLimitRefusal(leagueId: string, changes: RosterChange[]): Promise<string | null> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true, sport: true } })
  const limits = readPositionLimits(league?.settings)
  if (Object.keys(limits).length === 0 || changes.length === 0) return null

  const positions = await resolvePlayerPositions({
    leagueId,
    sport: String(league?.sport ?? 'NFL'),
    playerIds: changes.flatMap((c) => [...c.before, ...c.after]),
  })
  const pos = (ids: string[]) => ids.map((id) => positions.get(id) ?? null)
  for (const c of changes) {
    const breach = positionLimitBreaches(limits, pos(c.before), pos(c.after))[0]
    if (breach) return positionLimitMessage(breach, c.teamLabel)
  }
  return null
}

/**
 * The position-limit refusal for a trade: every participant's roster before and after the player
 * assets move. Called when the trade is proposed AND again when it is processed, because rosters
 * change in between (a waiver add on Wednesday can make Sunday's accepted trade illegal).
 */
export async function tradePositionLimitRefusal(
  leagueId: string,
  /** The participants, or a loader for them — called only when the league has limits. */
  rostersOrLoader:
    | Array<{ id: string; playerData: unknown }>
    | (() => Promise<Array<{ id: string; playerData: unknown }>>),
  assets: Array<{ itemType: string; itemReference?: string | null; fromRosterId: string; toRosterId: string }>,
): Promise<string | null> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  if (Object.keys(readPositionLimits(league?.settings)).length === 0) return null
  const rosters = typeof rostersOrLoader === 'function' ? await rostersOrLoader() : rostersOrLoader

  const { getRosterPlayerIds } = await import('@/lib/waiver-wire/roster-utils')
  const { buildRosterLabelMap } = await import('@/lib/scoring-engine/resolveTeamLabels')
  const labels = await buildRosterLabelMap(leagueId).catch(() => new Map<string, string>())
  const moves = assets.filter((a) => a.itemType === 'player' && a.itemReference)
  const changes: RosterChange[] = rosters.map((r) => {
    const before = getRosterPlayerIds(r.playerData)
    const out = new Set(moves.filter((a) => a.fromRosterId === r.id).map((a) => String(a.itemReference)))
    const incoming = moves.filter((a) => a.toRosterId === r.id).map((a) => String(a.itemReference))
    return { rosterId: r.id, before, after: [...before.filter((id) => !out.has(id)), ...incoming], teamLabel: labels.get(r.id) }
  })
  return positionLimitRefusal(leagueId, changes)
}

/**
 * The same refusal for the native redraft trade system (`/api/redraft/trade-proposals`), whose rosters
 * are `RedraftRoster` ids and whose players are `RedraftRosterPlayer` rows — those rows carry the
 * position, so no lookup is needed. Checked at proposal and again at settlement.
 */
export async function redraftTradePositionLimitRefusal(input: {
  leagueId: string
  rosterIds: string[]
  assets: Array<{ assetType?: string | null; playerId?: string | null; fromRosterId: string; toRosterId: string }>
}): Promise<string | null> {
  const league = await prisma.league.findUnique({ where: { id: input.leagueId }, select: { settings: true } })
  const limits = readPositionLimits(league?.settings)
  if (Object.keys(limits).length === 0) return null

  const [rows, rosters] = await Promise.all([
    prisma.redraftRosterPlayer.findMany({
      where: { rosterId: { in: input.rosterIds }, droppedAt: null },
      select: { rosterId: true, playerId: true, position: true },
    }),
    prisma.redraftRoster.findMany({ where: { id: { in: input.rosterIds } }, select: { id: true, teamName: true, ownerName: true } }),
  ])
  const positionOf = new Map(rows.map((r) => [r.playerId, r.position]))
  const moves = input.assets.filter((a) => (a.assetType ?? 'player') === 'player' && a.playerId)
  for (const rosterId of input.rosterIds) {
    const before = rows.filter((r) => r.rosterId === rosterId).map((r) => r.playerId)
    const out = new Set(moves.filter((a) => a.fromRosterId === rosterId).map((a) => String(a.playerId)))
    const after = [...before.filter((id) => !out.has(id)), ...moves.filter((a) => a.toRosterId === rosterId).map((a) => String(a.playerId))]
    const breach = positionLimitBreaches(
      limits,
      before.map((id) => positionOf.get(id) ?? null),
      after.map((id) => positionOf.get(id) ?? null),
    )[0]
    if (breach) {
      const r = rosters.find((x) => x.id === rosterId)
      return positionLimitMessage(breach, r?.teamName?.trim() || r?.ownerName?.trim() || 'A team')
    }
  }
  return null
}
