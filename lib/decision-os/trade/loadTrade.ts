import 'server-only'

import { prisma } from '@/lib/prisma'
import { assertLeagueCommissioner, assertLeagueMember } from '@/lib/league/league-access'
import { rosterIdMapKeys } from '@/lib/core-app/rosterIdMatch'
import { resolveViewerLeagueRoster } from '@/lib/trade-intel/viewerLeagueRoster'
import { resolveSourceScreenLink } from '@/lib/league-links/sourceLinkResolver'
import {
  afItemAsset,
  afTradeStatus,
  providerAsset,
  providerTradeStatus,
  redraftAsset,
  redraftTradeStatus,
  twoSides,
  viewerIdsFor,
  viewerIsParty,
  normTeamId,
  type LoadTradeResult,
  type LoadedTrade,
  type LoadedTradeAsset,
  type RawTrade,
  type TradeOrigin,
  type TradeRef,
  type TradeRefusal,
  type TradeStatus,
  type ViewerIdentity,
} from './tradeRecord'
import { playerIdSpaceFor, resolveTradePlayers, type PlayerIdSpace, type ResolvedTradePlayer } from './tradePlayers'

/**
 * Read an EXISTING trade from the tables it already lives in and return it normalized (see
 * `./tradeRecord.ts`). Design build-order step 2 (`docs/TRADE_EVALUATOR_DESIGN.md`): no new trade
 * tables — a thin read over `AfLeagueTrade`, `RedraftTradeProposal` and the `ProviderTradeOffer`
 * ledger.
 *
 * 🛑 DATABASE ONLY. The Sleeper side reads the stored ledger, never Sleeper — a request path does not
 * call a provider (`scripts/check-db-first-api-boundary.mjs`). The ledger is as fresh as its sweep;
 * `origin.rostersSyncedAt` says how fresh that is instead of pretending.
 *
 * 🛑 MEMBERSHIP IS CHECKED HERE. Every other trade reader relies on its route to gate it; this one is
 * meant to be called from anywhere (a route, Chimmy, the nightly agent), so it refuses a user who is
 * not in the league itself — `not_member`, before a single trade row is read.
 *
 * 🛑 A PENDING OFFER IS PRIVATE, AND THE GATE COMES BEFORE ANY ASSET IS READ. Only its managers and
 * the commissioner may load one. The check runs on the trade ROW — parties and status — before a
 * single asset is examined, because every later refusal names assets ("player 4984 could not be
 * matched…"), and a refusal that names what someone else offered is the leak.
 *
 * Never throws: every failure is a named refusal.
 */

type LeagueRow = {
  id: string
  platform: string | null
  platformLeagueId: string | null
  sport: string
  season: number | null
  lastSyncedAt: Date | null
  name: string | null
}

type AfRow = {
  id: string
  leagueId: string
  status: string
  proposerRosterId: string
  receiverRosterId: string
  createdAt: Date
  processedAt: Date | null
  expiresAt: Date | null
  metadata: unknown
  items: Array<{ itemType: string; itemReference: string | null; fromRosterId: string; toRosterId: string; faabAmount: number | null; metadata: unknown }>
}

type RedraftRow = {
  id: string
  leagueId: string
  status: string
  proposerRosterId: string
  receiverRosterId: string
  createdAt: Date
  processedAt: Date | null
  expiresAt: Date | null
  assets: Array<{
    assetType: string
    playerId: string | null
    playerName: string | null
    pickSeason: number | null
    pickRound: number | null
    fromRosterId: string
    toRosterId: string
    metadata: unknown
  }>
}

type ProviderRow = {
  id: string
  leagueId: string
  provider: string
  providerTradeId: string
  status: string
  proposedByRosterId: string | null
  rosterIds: string[]
  proposedAt: Date | null
  respondedAt: Date | null
  firstSeenAt: Date
  lastSeenAt: Date
  assets: Array<{
    assetType: string
    playerId: string | null
    pickSeason: number | null
    pickRound: number | null
    pickOriginalRosterId: string | null
    faabAmount: number | null
    fromRosterId: string | null
    toRosterId: string | null
  }>
}

export type LoadTradeDeps = {
  now: () => Date
  isMember: (leagueId: string, userId: string) => Promise<boolean>
  loadLeague: (leagueId: string) => Promise<LeagueRow | null>
  loadAfTrade: (leagueId: string, tradeId: string) => Promise<AfRow | null>
  loadRedraftProposal: (leagueId: string, proposalId: string) => Promise<RedraftRow | null>
  loadProviderOffer: (leagueId: string, provider: string, providerTradeId: string) => Promise<ProviderRow | null>
  /** `RedraftRoster.id` → `Roster.id`, through the unique `Roster.redraftRosterId`. */
  rostersForRedraft: (leagueId: string, redraftRosterIds: string[]) => Promise<Map<string, string>>
  resolvePlayers: (ids: readonly string[], opts: { space: PlayerIdSpace; sport: string }) => Promise<Map<string, ResolvedTradePlayer>>
  /** The viewer's ids in every space a trade source uses. */
  viewerIdentity: (leagueId: string, userId: string) => Promise<ViewerIdentity>
  isCommissioner: (leagueId: string, userId: string) => Promise<boolean>
}

const maybe = <T>(p: Promise<T>): Promise<T | null> => p.catch(() => null)

export const defaultLoadTradeDeps: LoadTradeDeps = {
  now: () => new Date(),
  isMember: async (leagueId, userId) => {
    const access = await assertLeagueMember(leagueId, userId).catch(() => null)
    return Boolean(access?.ok)
  },
  loadLeague: (leagueId) =>
    maybe(
      prisma.league.findUnique({
        where: { id: leagueId },
        select: { id: true, platform: true, platformLeagueId: true, sport: true, season: true, lastSyncedAt: true, name: true },
      }),
    ) as Promise<LeagueRow | null>,
  loadAfTrade: (leagueId, tradeId) =>
    maybe(
      prisma.afLeagueTrade.findFirst({
        where: { id: tradeId, leagueId },
        select: {
          id: true, leagueId: true, status: true, proposerRosterId: true, receiverRosterId: true,
          createdAt: true, processedAt: true, expiresAt: true, metadata: true,
          items: { select: { itemType: true, itemReference: true, fromRosterId: true, toRosterId: true, faabAmount: true, metadata: true } },
        },
      }),
    ),
  loadRedraftProposal: (leagueId, proposalId) =>
    maybe(
      prisma.redraftTradeProposal.findFirst({
        where: { id: proposalId, leagueId },
        select: {
          id: true, leagueId: true, status: true, proposerRosterId: true, receiverRosterId: true,
          createdAt: true, processedAt: true, expiresAt: true,
          assets: { select: { assetType: true, playerId: true, playerName: true, pickSeason: true, pickRound: true, fromRosterId: true, toRosterId: true, metadata: true } },
        },
      }),
    ),
  loadProviderOffer: (leagueId, provider, providerTradeId) =>
    maybe(
      prisma.providerTradeOffer.findUnique({
        where: { uniq_provider_trade_offer: { provider, leagueId, providerTradeId } },
        select: {
          id: true, leagueId: true, provider: true, providerTradeId: true, status: true, proposedByRosterId: true,
          rosterIds: true, proposedAt: true, respondedAt: true, firstSeenAt: true, lastSeenAt: true,
          assets: { select: { assetType: true, playerId: true, pickSeason: true, pickRound: true, pickOriginalRosterId: true, faabAmount: true, fromRosterId: true, toRosterId: true } },
        },
      }),
    ),
  rostersForRedraft: async (leagueId, redraftRosterIds) => {
    const rows = await prisma.roster
      .findMany({ where: { leagueId, redraftRosterId: { in: redraftRosterIds } }, select: { id: true, redraftRosterId: true } })
      .catch(() => [] as Array<{ id: string; redraftRosterId: string | null }>)
    return new Map(rows.flatMap((r) => (r.redraftRosterId ? [[r.redraftRosterId, r.id] as const] : [])))
  },
  resolvePlayers: resolveTradePlayers,
  viewerIdentity: async (leagueId, userId) => {
    const v = await resolveViewerLeagueRoster(leagueId, userId).catch(() => null)
    if (!v?.ok) return { rosterId: null, redraftRosterId: null, externalTeamIds: [] }
    const row = await prisma.roster
      .findUnique({ where: { id: v.roster.id }, select: { redraftRosterId: true } })
      .catch(() => null)
    return {
      rosterId: v.roster.id,
      redraftRosterId: row?.redraftRosterId ?? null,
      externalTeamIds: v.team.externalId ? rosterIdMapKeys(v.team.externalId) : [],
    }
  },
  isCommissioner: async (leagueId, userId) =>
    Boolean((await assertLeagueCommissioner(leagueId, userId).catch(() => null))?.ok),
}

const refuse = (code: TradeRefusal['code'], reason: string, missingAssets: string[] = []): LoadTradeResult => ({
  ok: false,
  refusal: { code, reason, missingAssets },
})

const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null)

function platformOf(league: LeagueRow): string {
  const p = String(league.platform ?? '').trim().toLowerCase()
  return !p || p === 'manual' || p === 'native' || p === 'allfantasy' ? 'native' : p
}

function originFor(args: {
  league: LeagueRow
  source: TradeOrigin['source']
  platform: string
  externalTradeId: string | null
  rawStatus: string
  now: Date
}): TradeOrigin {
  const native = args.platform === 'native'
  const link =
    !native && args.league.platformLeagueId
      ? resolveSourceScreenLink({
          platform: args.platform,
          sourceLeagueId: args.league.platformLeagueId,
          leagueName: args.league.name,
          season: args.league.season,
          screen: 'trade',
        })
      : null
  return {
    source: args.source,
    platform: args.platform,
    externalLeagueId: native ? null : args.league.platformLeagueId || null,
    externalTradeId: args.externalTradeId,
    deepLink: link?.href ?? null,
    // Native rosters ARE the source of truth, so they are current as of now; imported ones are as
    // fresh as the league's last sync, and unknown when it never synced.
    rostersSyncedAt: native ? args.now.toISOString() : iso(args.league.lastSyncedAt),
    rawStatus: args.rawStatus,
  }
}

/** Resolve every player id in a raw trade, or refuse naming each one that did not resolve to exactly one player. */
async function withPlayers(
  raw: RawTrade,
  league: LeagueRow,
  space: PlayerIdSpace,
  resolvePlayers: LoadTradeDeps['resolvePlayers'],
): Promise<{ ok: true; sides: { a: LoadedTradeAsset[]; b: LoadedTradeAsset[] } } | { ok: false; refusal: TradeRefusal }> {
  const ids = [...raw.sideA.gives, ...raw.sideB.gives].flatMap((a) => (a.kind === 'player' ? [a.playerId] : []))
  const found = ids.length ? await resolvePlayers(ids, { space, sport: league.sport }).catch(() => new Map<string, ResolvedTradePlayer>()) : new Map<string, ResolvedTradePlayer>()
  const missing: string[] = []
  const toLoaded = (asset: RawTrade['sideA']['gives'][number]): LoadedTradeAsset | null => {
    if (asset.kind !== 'player') return asset
    const p = found.get(asset.playerId)
    if (!p || !p.ok) {
      missing.push(`player ${asset.playerId} (${p && !p.ok && p.why === 'ambiguous' ? 'matches more than one player' : 'no player found'})`)
      return null
    }
    return { kind: 'player', playerId: asset.playerId, name: p.name, position: p.position }
  }
  const a = raw.sideA.gives.map(toLoaded)
  const b = raw.sideB.gives.map(toLoaded)
  if (missing.length) {
    return {
      ok: false,
      refusal: {
        code: 'unresolved_player',
        reason: `${missing.slice(0, 3).join(', ')} could not be matched to exactly one ${league.sport} player, so this trade can't be evaluated yet.`,
        missingAssets: missing,
      },
    }
  }
  return { ok: true, sides: { a: a as LoadedTradeAsset[], b: b as LoadedTradeAsset[] } }
}

const PRIVATE_REFUSAL = refuse(
  'not_party',
  'This is a pending offer between other managers; only they and the commissioner can evaluate it. If it is yours, claim your team in this league first.',
)

/** Load one trade the viewer can see. `leagueId` is the AllFantasy league the trade belongs to. */
export async function loadTrade(
  args: { leagueId: string; ref: TradeRef; userId: string },
  deps: Partial<LoadTradeDeps> = {},
): Promise<LoadTradeResult> {
  const d: LoadTradeDeps = { ...defaultLoadTradeDeps, ...deps }
  const now = d.now()
  if (!args.userId || !(await d.isMember(args.leagueId, args.userId).catch(() => false))) {
    return refuse('not_member', 'This trade is in a league you are not a member of.')
  }
  const league = await d.loadLeague(args.leagueId).catch(() => null)
  if (!league) return refuse('not_found', 'That league could not be found.')
  const viewer = await d.viewerIdentity(league.id, args.userId).catch(
    (): ViewerIdentity => ({ rosterId: null, redraftRosterId: null, externalTeamIds: [] }),
  )
  let commissioner: boolean | null = null
  const isCommissioner = async () => (commissioner ??= await d.isCommissioner(league.id, args.userId).catch(() => false))
  /** The privacy gate — on the row's parties and status, before any asset is read. */
  const mayView = async (source: TradeOrigin['source'], status: TradeStatus, parties: ReadonlyArray<string | null | undefined>) =>
    status !== 'proposed' || viewerIsParty(source, viewer, parties) || (await isCommissioner())

  let raw: RawTrade
  let status: TradeStatus
  let origin: TradeOrigin
  let id: string
  let proposedAt: string | null
  let completedAt: string | null
  let rosterIdFor: (teamId: string) => string | null
  let space: PlayerIdSpace

  if (args.ref.kind === 'af') {
    const row = await d.loadAfTrade(league.id, args.ref.tradeId).catch(() => null)
    if (!row) return refuse('not_found', 'That trade could not be found in this league.')
    const meta = row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata) ? (row.metadata as Record<string, unknown>) : {}
    const declared = Array.isArray(meta.participantRosterIds) ? meta.participantRosterIds.filter((x): x is string => typeof x === 'string') : []
    const afStatus = afTradeStatus(row.status, row.expiresAt, now)
    const afParties = [row.proposerRosterId, row.receiverRosterId, ...declared, ...row.items.flatMap((i) => [i.fromRosterId, i.toRosterId])]
    if (!(await mayView('af', afStatus, afParties))) return PRIVATE_REFUSAL
    const sides = twoSides(
      row.items.map((i) => ({ fromTeamId: i.fromRosterId, toTeamId: i.toRosterId, asset: afItemAsset(i) })),
      { sideAId: row.proposerRosterId, sideBId: row.receiverRosterId, declaredTeamIds: declared },
    )
    if (!sides.ok) return sides
    raw = sides.trade
    const platform = platformOf(league)
    status = afStatus
    origin = originFor({ league, source: 'af', platform, externalTradeId: null, rawStatus: row.status, now })
    id = row.id
    proposedAt = iso(row.createdAt)
    completedAt = iso(row.processedAt)
    rosterIdFor = (teamId) => teamId // AfLeagueTrade already speaks Roster.id
    space = playerIdSpaceFor({ platform: league.platform, sport: league.sport })
  } else if (args.ref.kind === 'redraft') {
    const row = await d.loadRedraftProposal(league.id, args.ref.proposalId).catch(() => null)
    if (!row) return refuse('not_found', 'That trade could not be found in this league.')
    const rdStatus = redraftTradeStatus(row.status, row.expiresAt, now)
    const rdParties = [row.proposerRosterId, row.receiverRosterId, ...row.assets.flatMap((a) => [a.fromRosterId, a.toRosterId])]
    if (!(await mayView('redraft', rdStatus, rdParties))) return PRIVATE_REFUSAL
    const sides = twoSides(
      row.assets.map((a) => ({ fromTeamId: a.fromRosterId, toTeamId: a.toRosterId, asset: redraftAsset(a) })),
      { sideAId: row.proposerRosterId, sideBId: row.receiverRosterId },
    )
    if (!sides.ok) return sides
    raw = sides.trade
    const mapped = await d.rostersForRedraft(league.id, [row.proposerRosterId, row.receiverRosterId]).catch(() => new Map<string, string>())
    status = rdStatus
    origin = originFor({ league, source: 'redraft', platform: platformOf(league), externalTradeId: null, rawStatus: row.status, now })
    id = row.id
    proposedAt = iso(row.createdAt)
    completedAt = iso(row.processedAt)
    // ~15% of RedraftRosters have no Roster link; those sides grade by name with no lineup effect.
    rosterIdFor = (teamId) => mapped.get(teamId) ?? null
    space = playerIdSpaceFor({ platform: league.platform, sport: league.sport })
  } else {
    const row = await d.loadProviderOffer(league.id, args.ref.provider, args.ref.providerTradeId).catch(() => null)
    if (!row) return refuse('not_found', 'That trade is not in the stored trade ledger for this league.')
    const pvStatus = providerTradeStatus(row.status)
    const pvParties = [...row.rosterIds, ...row.assets.flatMap((a) => [a.fromRosterId, a.toRosterId])]
    if (!(await mayView('provider', pvStatus, pvParties))) return PRIVATE_REFUSAL
    const sides = twoSides(
      row.assets.map((a) => ({ fromTeamId: a.fromRosterId, toTeamId: a.toRosterId, asset: providerAsset(a) })),
      { sideAId: row.proposedByRosterId, declaredTeamIds: row.rosterIds },
    )
    if (!sides.ok) return sides
    raw = sides.trade
    status = pvStatus
    origin = {
      ...originFor({ league, source: 'provider', platform: row.provider, externalTradeId: row.providerTradeId, rawStatus: row.status, now }),
      /*
       * ⚠ THE LEDGER IS FRESHER THAN THE LEAGUE SYNC FOR THIS TRADE, AND STALER FOR THE ROSTERS.
       * `lastSeenAt` is when the sweep last saw the offer; rosters still come from the league sync.
       * The older of the two is the honest freshness of "is this still the deal".
       */
      rostersSyncedAt: [iso(league.lastSyncedAt), iso(row.lastSeenAt)].filter((x): x is string => !!x).sort()[0] ?? null,
    }
    id = row.id
    proposedAt = iso(row.proposedAt ?? row.firstSeenAt)
    completedAt = status === 'completed' ? iso(row.respondedAt) : null
    rosterIdFor = () => null // External roster ids: mapped through the canonical world by the evaluator.
    space = 'sleeper'
  }

  const players = await withPlayers(raw, league, space, d.resolvePlayers)
  if (!players.ok) return players

  const trade: LoadedTrade = {
    id,
    leagueId: league.id,
    sport: league.sport,
    origin,
    status,
    sideA: { teamId: raw.sideA.teamId, rosterId: rosterIdFor(raw.sideA.teamId), gives: players.sides.a },
    sideB: { teamId: raw.sideB.teamId, rosterId: rosterIdFor(raw.sideB.teamId), gives: players.sides.b },
    proposedAt,
    completedAt,
  }
  // A pick's original owner is in the same id space as the sides; map it the same way when it can be.
  for (const side of [trade.sideA, trade.sideB]) {
    side.gives = side.gives.map((g) =>
      g.kind === 'pick' && g.originalTeamId && args.ref.kind !== 'provider'
        ? { ...g, originalTeamId: rosterIdFor(g.originalTeamId) ?? g.originalTeamId }
        : g,
    )
  }
  const mine = new Set(viewerIdsFor(trade.origin.source, viewer))
  const side = mine.has(normTeamId(trade.sideA.teamId)) ? 'A' : mine.has(normTeamId(trade.sideB.teamId)) ? 'B' : null
  return { ok: true, trade, viewer: { side, isCommissioner: await isCommissioner() } }
}
