import 'server-only'

import { prisma } from '@/lib/prisma'
import { assertLeagueMember } from '@/lib/league/league-access'
import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'
import { getPlayer } from '@/lib/data/players'
import { pricePick, pricePlayer, type ValuationContext } from '@/lib/hybrid-valuation'
import type { Asset } from '@/lib/trade-engine/types'
import type { SupportedSport } from '@/lib/sport-scope'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { pricedAssetToEngineAsset } from './priced-asset-to-asset'
import { sportsRecordToPricedAsset } from './sports-db-valuation'

/** Mirrors internal `RosterContext` in trade-engine (not exported). */
export type TradeEngineRosterContext = {
  yourRoster: Asset[]
  theirRoster: Asset[]
  rosterPositions: string[]
}

/** Shapes expected by `buildNegotiationToolkit` `availablePicks`. */
export type NegotiationAvailablePick = {
  id: string
  displayName?: string
  round?: number
  season?: number
  value?: number
}

function parseDraftPicksRaw(playerData: unknown): Array<{ year: number; round: number }> {
  const rec = playerData && typeof playerData === 'object' ? (playerData as Record<string, unknown>) : null
  const arr = rec && Array.isArray(rec.draftPicks) ? rec.draftPicks : []
  const out: Array<{ year: number; round: number }> = []
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const season = o.season ?? o.year
    const year =
      typeof season === 'number'
        ? season
        : typeof season === 'string'
          ? parseInt(season, 10)
          : NaN
    const round = typeof o.round === 'number' ? o.round : 1
    if (!Number.isFinite(year)) continue
    out.push({ year, round })
  }
  return out
}

async function loadUserFaabAndNegotiationPicks(args: {
  userRoster: { faabRemaining: number | null; playerData: unknown }
  effectiveSport: SupportedSport
  nflCtx: ValuationContext
  dataGaps: string[]
}): Promise<{ userFaabRemaining: number | null; availablePicks: NegotiationAvailablePick[] }> {
  const faab = args.userRoster.faabRemaining
  const userFaabRemaining = typeof faab === 'number' && Number.isFinite(faab) ? faab : null
  const availablePicks: NegotiationAvailablePick[] = []

  if (args.effectiveSport !== 'NFL') {
    return { userFaabRemaining, availablePicks }
  }

  const raw = parseDraftPicksRaw(args.userRoster.playerData)
  for (let i = 0; i < Math.min(raw.length, 12); i++) {
    const p = raw[i]
    try {
      const priced = await pricePick({ year: p.year, round: p.round, tier: null }, args.nflCtx)
      availablePicks.push({
        id: `pick_${p.year}_r${p.round}_${i}`,
        displayName: priced.name,
        round: p.round,
        season: p.year,
        value: priced.assetValue.marketValue,
      })
    } catch {
      args.dataGaps.push(`Could not price draft pick ${p.year} R${p.round}`)
    }
  }

  return { userFaabRemaining, availablePicks }
}

/** Your roster players not already included in the outgoing side (by `Asset.id`). */
export function benchAssetsNotInGive(yourRoster: Asset[], give: Asset[]): Asset[] {
  const giveIds = new Set(give.map((g) => g.id))
  return yourRoster.filter((a) => !giveIds.has(a.id))
}

/** Heuristic: positions with fewer players than a shallow redraft minimum (NFL / NCAAF only). */
export function inferThinPositionsFromRoster(assets: Asset[], sport: SupportedSport | 'MIXED'): string[] {
  if (sport === 'MIXED' || (sport !== 'NFL' && sport !== 'NCAAF')) {
    return []
  }
  const counts: Record<string, number> = {}
  for (const a of assets) {
    if (a.type !== 'PLAYER' || !a.pos) continue
    const p = a.pos.toUpperCase()
    if (['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].includes(p)) {
      counts[p] = (counts[p] ?? 0) + 1
    }
  }
  const min: Record<string, number> = { QB: 1, RB: 2, WR: 2, TE: 1 }
  const needs: string[] = []
  for (const [pos, m] of Object.entries(min)) {
    if ((counts[pos] ?? 0) < m) needs.push(pos)
  }
  return needs
}

const DEFAULT_NFL_SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'SUPER_FLEX']

function normalizeStarters(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length === 0) return []
  return raw.map((x) => String(x).trim().toUpperCase()).filter(Boolean)
}

async function resolveNflIdToName(playerIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (playerIds.length === 0) return map
  try {
    const { getAllPlayers } = await import('@/lib/sleeper-client')
    const all = await getAllPlayers()
    for (const id of playerIds) {
      const p = all[id]
      const name =
        p?.full_name ||
        (p ? `${(p as { first_name?: string }).first_name ?? ''} ${(p as { last_name?: string }).last_name ?? ''}`.trim() : '')
      if (name) map.set(id, name)
    }
  } catch {
    /* ignore */
  }
  return map
}

async function rosterIdsToAssets(args: {
  playerIds: string[]
  sport: SupportedSport
  nflCtx: ValuationContext
  dataGaps: string[]
}): Promise<Asset[]> {
  const ids = args.playerIds.slice(0, 45)
  const out: Asset[] = []

  if (args.sport === 'NFL') {
    const nameMap = await resolveNflIdToName(ids)
    for (const id of ids) {
      const name = nameMap.get(id)?.trim() || id
      try {
        const pa = await pricePlayer(name, args.nflCtx)
        out.push(pricedAssetToEngineAsset(pa))
      } catch {
        args.dataGaps.push(`Could not price roster player "${name}"`)
      }
    }
    return out
  }

  for (const id of ids) {
    try {
      const row = await getPlayer(id)
      if (row) {
        const pa = sportsRecordToPricedAsset(row)
        if (pa) {
          out.push(pricedAssetToEngineAsset(pa))
        } else {
          // Honesty pass: no dynasty value and no projection for this player.
          // Previously a hardcoded 1200 stood in here, which made unpriceable
          // players look identically valuable.
          args.dataGaps.push(`No market value or projection available for "${row.name}"`)
        }
      }
    } catch {
      args.dataGaps.push(`Could not load roster player id ${id.slice(0, 24)}…`)
    }
  }
  return out
}

export type OpponentTeamOption = {
  externalId: string
  teamName: string
  ownerName: string
  platformUserId: string | null
}

export async function loadTradeEngineRosterContext(args: {
  leagueId: string
  userId: string
  opponentTeamExternalId?: string | null
  effectiveSport: SupportedSport
  nflCtx: ValuationContext
  dataGaps: string[]
}): Promise<{
  rosterCtx: TradeEngineRosterContext | null
  opponentTeams: OpponentTeamOption[]
  yourAssetCount: number
  theirAssetCount: number
  userFaabRemaining: number | null
  availablePicks: NegotiationAvailablePick[]
}> {
  const access = await assertLeagueMember(args.leagueId, args.userId)
  if (!access.ok) {
    return {
      rosterCtx: null,
      opponentTeams: [],
      yourAssetCount: 0,
      theirAssetCount: 0,
      userFaabRemaining: null,
      availablePicks: [],
    }
  }

  const league = await prisma.league.findFirst({
    where: { id: args.leagueId },
    select: { id: true, starters: true, sport: true },
  })
  if (!league) {
    return {
      rosterCtx: null,
      opponentTeams: [],
      yourAssetCount: 0,
      theirAssetCount: 0,
      userFaabRemaining: null,
      availablePicks: [],
    }
  }

  const teams = await prisma.leagueTeam.findMany({
    where: { leagueId: args.leagueId },
    select: { externalId: true, teamName: true, ownerName: true, platformUserId: true, claimedByUserId: true },
    orderBy: { pointsFor: 'desc' },
  })

  const opponentTeams: OpponentTeamOption[] = teams.map((t) => ({
    externalId: t.externalId,
    teamName: t.teamName,
    ownerName: t.ownerName,
    platformUserId: t.platformUserId,
  }))

  const rosters = await prisma.roster.findMany({
    where: { leagueId: args.leagueId },
    select: { platformUserId: true, playerData: true, faabRemaining: true },
  })

  const userRoster = rosters.find((r) => r.platformUserId === args.userId)
  if (!userRoster) {
    args.dataGaps.push('No synced roster row for your account in this league — lineup impact uses trade assets only.')
    return {
      rosterCtx: null,
      opponentTeams,
      yourAssetCount: 0,
      theirAssetCount: 0,
      userFaabRemaining: null,
      availablePicks: [],
    }
  }

  const { userFaabRemaining, availablePicks } = await loadUserFaabAndNegotiationPicks({
    userRoster,
    effectiveSport: args.effectiveSport,
    nflCtx: args.nflCtx,
    dataGaps: args.dataGaps,
  })

  let oppRoster = null as (typeof rosters)[0] | null
  if (args.opponentTeamExternalId) {
    const team = teams.find((t) => t.externalId === args.opponentTeamExternalId)
    if (team?.platformUserId) {
      oppRoster = rosters.find((r) => r.platformUserId === team.platformUserId) ?? null
    }
  }
  if (!oppRoster) {
    oppRoster = rosters.find((r) => r.platformUserId !== args.userId) ?? null
  }

  const sport = normalizeToSupportedSport(league.sport)
  let positions = normalizeStarters(league.starters)
  if (positions.length === 0 && sport === 'NFL') {
    positions = DEFAULT_NFL_SLOTS
    args.dataGaps.push('League starter slots missing — using default NFL slot template for lineup simulation.')
  } else if (positions.length === 0) {
    args.dataGaps.push('League starter slots missing — skipping lineup simulation for this sport.')
    return {
      rosterCtx: null,
      opponentTeams,
      yourAssetCount: getRosterPlayerIds(userRoster.playerData).length,
      theirAssetCount: oppRoster ? getRosterPlayerIds(oppRoster.playerData).length : 0,
      userFaabRemaining,
      availablePicks,
    }
  }

  const yourIds = getRosterPlayerIds(userRoster.playerData)
  const theirIds = oppRoster ? getRosterPlayerIds(oppRoster.playerData) : []

  const [yourRoster, theirRosterAssets] = await Promise.all([
    rosterIdsToAssets({
      playerIds: yourIds,
      sport: args.effectiveSport,
      nflCtx: args.nflCtx,
      dataGaps: args.dataGaps,
    }),
    theirIds.length
      ? rosterIdsToAssets({
          playerIds: theirIds,
          sport: args.effectiveSport,
          nflCtx: args.nflCtx,
          dataGaps: args.dataGaps,
        })
      : Promise.resolve([] as Asset[]),
  ])

  if (yourRoster.length === 0) {
    return {
      rosterCtx: null,
      opponentTeams,
      yourAssetCount: 0,
      theirAssetCount: theirRosterAssets.length,
      userFaabRemaining,
      availablePicks,
    }
  }

  return {
    rosterCtx: {
      yourRoster,
      theirRoster: theirRosterAssets,
      rosterPositions: positions,
    },
    opponentTeams,
    yourAssetCount: yourRoster.length,
    theirAssetCount: theirRosterAssets.length,
    userFaabRemaining,
    availablePicks,
  }
}
