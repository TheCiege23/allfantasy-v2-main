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
import { loadImportedFuturePicks } from '@/lib/league-trade-engine/importedFuturePicks'
import { isNativeFuturePickLeague, loadNativeFuturePicks } from '@/lib/league-trade-engine/nativeFuturePicks'
import { inventoryPickId, type InventoryPick } from '@/lib/league-trade-engine/futurePickInventory'
import { livePickValue } from './leagueTradePricing'
import { resolveViewerLeagueRoster } from '@/lib/trade-intel/viewerLeagueRoster'

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

async function loadUserFaabAndNegotiationPicks(args: {
  userRoster: { faabRemaining: number | null; playerData: unknown }
  effectiveSport: SupportedSport
  nflCtx: ValuationContext
  dataGaps: string[]
  picks: InventoryPick[]
}): Promise<{ userFaabRemaining: number | null; availablePicks: NegotiationAvailablePick[] }> {
  const faab = args.userRoster.faabRemaining
  const userFaabRemaining = typeof faab === 'number' && Number.isFinite(faab) ? faab : null
  const availablePicks: NegotiationAvailablePick[] = []

  if (args.effectiveSport !== 'NFL') {
    return { userFaabRemaining, availablePicks }
  }

  for (const p of args.picks) {
    try {
      const priced = await pricePick({ year: p.season, round: p.round, tier: null }, args.nflCtx)
      availablePicks.push({
        id: inventoryPickId(p),
        displayName: priced.name,
        round: p.round,
        season: p.season,
        value: livePickValue(args.nflCtx.fantasyCalcPlayers ?? [], p.season, p.round, null) ?? priced.assetValue.marketValue,
      })
    } catch {
      args.dataGaps.push(`Could not price draft pick ${p.season} R${p.round}`)
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
  const ids = [...new Set(args.playerIds)]
  const out: Asset[] = []

  if (args.sport === 'NFL') {
    const nameMap = await resolveNflIdToName(ids)
    for (const id of ids) {
      const name = nameMap.get(id)?.trim() || id
      try {
        const pa = await pricePlayer(name, args.nflCtx)
        out.push({ ...pricedAssetToEngineAsset(pa), rosterPlayerId: id })
      } catch {
        args.dataGaps.push(`Could not price roster player "${name}"`)
      }
    }
    return out
  }

  for (const id of ids) {
    try {
      const row = await getPlayer(id, { sport: args.sport })
      if (row) {
        const pa = sportsRecordToPricedAsset(row)
        if (pa) {
          out.push({ ...pricedAssetToEngineAsset(pa), rosterPlayerId: id })
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
    select: { id: true, starters: true, sport: true, platform: true, leagueType: true, isDynasty: true, season: true, settings: true },
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
    select: { id: true, externalId: true, teamName: true, ownerName: true, platformUserId: true, claimedByUserId: true },
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
    select: { id: true, platformUserId: true, playerData: true, faabRemaining: true },
  })

  const claimedTeam = teams.find(t => t.claimedByUserId === args.userId)
  // Imported viewer rows can carry either the app ID or the provider ID. The shared
  // resolver also handles linked, unclaimed teams and chooses the newest synced row.
  const viewer = await resolveViewerLeagueRoster(args.leagueId, args.userId).catch(() => null)
  const userPlatformId = viewer?.ok ? viewer.team.platformUserId : claimedTeam?.platformUserId ?? args.userId
  const userRoster = viewer?.ok
    ? rosters.find(r => r.id === viewer.roster.id)
    : rosters.find(r => r.platformUserId === args.userId) ?? rosters.find(r => r.platformUserId === userPlatformId)
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

  let ownedPicks: InventoryPick[] = []
  try {
    if (isNativeFuturePickLeague(league)) {
      ownedPicks = (await loadNativeFuturePicks(args.leagueId))?.picks.filter(p => p.ownerTeamId === userRoster.id) ?? []
    } else {
      const settings = league.settings && typeof league.settings === 'object' && !Array.isArray(league.settings)
        ? league.settings as Record<string, unknown> : null
      const inventory = await loadImportedFuturePicks({ leagueId: args.leagueId, platform: league.platform,
        isDynasty: league.isDynasty, leagueSeason: league.season,
        status: typeof settings?.status === 'string' ? settings.status : null, teams, rosters })
      ownedPicks = inventory.picksByRosterId.get(userRoster.id) ?? []
      if (inventory.readFailed) args.dataGaps.push('Future pick ownership could not be loaded; no pick sweeteners are suggested.')
    }
  } catch { args.dataGaps.push('Future pick ownership could not be loaded; no pick sweeteners are suggested.') }
  const { userFaabRemaining, availablePicks } = await loadUserFaabAndNegotiationPicks({
    userRoster,
    effectiveSport: args.effectiveSport,
    nflCtx: args.nflCtx,
    dataGaps: args.dataGaps,
    picks: ownedPicks,
  })

  let oppRoster = null as (typeof rosters)[0] | null
  if (args.opponentTeamExternalId) {
    const team = teams.find((t) => t.externalId === args.opponentTeamExternalId)
    if (team?.platformUserId && team.platformUserId !== userPlatformId) {
      oppRoster = rosters.find((r) => r.platformUserId === team.platformUserId) ?? null
    }
  }
  // An absent or stale selection must not silently become a different manager's roster.
  // Counteroffers and lineup context belong to the explicitly selected counterparty.

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
