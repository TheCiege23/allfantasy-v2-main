import 'server-only'

import { prisma } from '@/lib/prisma'
import { gradeDeal, type LeagueTradeGrader } from '@/lib/decision-os/trade/leagueTradeGrader'
import { gradePlayerFromRoster, type GradeInputs } from '@/lib/decision-os/trade/tradeGradeInputs'
import { resolveTradePlayers, type ResolvedTradePlayer } from '@/lib/decision-os/trade/tradePlayers'
import type { TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'
import type { PendingProviderTrade, PendingTradeAsset } from './scanPendingSleeperTrades'
import { espnDropLine, espnTeamId, splitEspnOfferForTeam, type LedgerOfferAssetLike } from './espnTradeOffers'

/**
 * A stored ESPN offer as ONE team sees it — names, the conditional-drop line, and the grader's
 * inputs. DB-first: it reads `provider_trade_offers` (written by `syncEspnTradeOffers.ts`) and the
 * identity map, never ESPN.
 *
 * 🛑 ESPN PLAYER IDS ARE NOT SLEEPER IDS (ESPN 12483 is Matthew Stafford, Sleeper 12483 is Jack Bech —
 * `contracts/espn/ENDPOINTS.yaml`). Every id goes through `resolveTradePlayers` in the `espn` space,
 * held to NFL, which is the same crosswalk ESPN's completed trades and native items use. An id it
 * cannot resolve to exactly one player is shown as unidentified and WITHHOLDS the grade, rather than
 * being priced as somebody else.
 */

const SPACE = { provider: 'espn' } as const

export type EspnLedgerRow = {
  providerTradeId: string
  status: string
  proposedByRosterId: string | null
  rosterIds: string[]
  consentedRosterIds: string[]
  proposedAt: Date | null
  firstSeenAt: Date
  expiresAt: Date | null
  assets: LedgerOfferAssetLike[]
}

export type EspnOfferView = {
  trade: PendingProviderTrade
  /** "and they drop Marvin Harrison Jr." — null when nobody drops anyone. */
  dropLine: string | null
  /** True when the viewer has already agreed on ESPN (they proposed it, or accepted it). */
  viewerConsented: boolean
  expiresAt: string | null
  give: GradeInputs
  get: GradeInputs
  /** The viewer's own conditional drops — part of what they give up. */
  giveDrops: GradeInputs
}

function inputsFor(ids: readonly string[], found: ReadonlyMap<string, ResolvedTradePlayer>): GradeInputs {
  const out: GradeInputs = { assets: [], unpriceable: [] }
  for (const id of ids) {
    const p = found.get(id)
    if (p?.ok) out.assets.push(gradePlayerFromRoster({ id, name: p.name, position: p.position, space: SPACE, identity: p }))
    else {
      out.unpriceable.push(`ESPN player ${id}`)
      out.valuationGap = 'unresolved_player'
    }
  }
  return out
}

function displayFor(id: string, found: ReadonlyMap<string, ResolvedTradePlayer>): PendingTradeAsset {
  const p = found.get(id)
  return {
    playerId: id,
    playerName: p?.ok ? p.name : 'Unidentified player',
    position: p?.ok && p.position ? p.position : '—',
    team: '—',
  }
}

/** PURE apart from the resolver passed in. Exported for tests. */
export function buildEspnOfferViews(args: {
  rows: readonly EspnLedgerRow[]
  viewerTeamId: string
  found: ReadonlyMap<string, ResolvedTradePlayer>
  teamNameOf?: (teamId: string | null) => string | null
}): EspnOfferView[] {
  const me = espnTeamId(args.viewerTeamId)
  if (!me) return []
  const out: EspnOfferView[] = []
  for (const row of args.rows) {
    // Owner rule (GAPS.md T-03): only offers this team sent or received, even if a row says otherwise.
    if (!row.rosterIds.includes(me) && row.proposedByRosterId !== me) continue
    const split = splitEspnOfferForTeam(row.assets, me)
    const nameOf = (id: string) => displayFor(id, args.found).playerName
    const proposedByViewer = row.proposedByRosterId === me
    const partner = split.partnerTeamId ?? row.rosterIds.find((r) => r !== me) ?? null
    out.push({
      trade: {
        transactionId: row.providerTradeId,
        proposedBy: proposedByViewer ? 'You' : args.teamNameOf?.(row.proposedByRosterId) ?? `Team ${row.proposedByRosterId ?? '?'}`,
        proposedByViewer,
        proposedAt: (row.proposedAt ?? row.firstSeenAt)?.toISOString() ?? null,
        assetsGiven: split.givePlayerIds.map((id) => displayFor(id, args.found)),
        assetsReceived: split.getPlayerIds.map((id) => displayFor(id, args.found)),
        readOnly: true,
        provider: 'espn',
        viewerRosterExternalId: me,
        counterpartyRosterExternalId: partner,
        lifecycleStatus: 'pending',
      },
      dropLine: espnDropLine({ viewerDrops: split.viewerDropIds.map(nameOf), partnerDrops: split.partnerDropIds.map(nameOf) }),
      viewerConsented: row.consentedRosterIds.includes(me) || proposedByViewer,
      expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
      give: inputsFor(split.givePlayerIds, args.found),
      get: inputsFor(split.getPlayerIds, args.found),
      giveDrops: inputsFor(split.viewerDropIds, args.found),
    })
  }
  return out
}

/** THE grade per offer, from the viewer's side, with their own conditional drops counted. */
export async function gradeEspnOfferViews(
  views: readonly EspnOfferView[],
  grader: LeagueTradeGrader | null,
): Promise<Map<string, TradeGradeView>> {
  const out = new Map<string, TradeGradeView>()
  await Promise.all(
    views.map(async (v) => {
      out.set(
        v.trade.transactionId,
        await gradeDeal(grader, { give: v.give, get: v.get, giveDrops: v.giveDrops, viewerSide: true }).catch(
          (): TradeGradeView => ({ graded: false, reason: 'This trade could not be graded just now.', basis: null }),
        ),
      )
    }),
  )
  return out
}

/** The viewer's ESPN team id in this AllFantasy league: their claimed team. Null when unclaimed. */
export async function viewerEspnTeamId(leagueId: string, userId: string): Promise<string | null> {
  const team = await prisma.leagueTeam
    .findFirst({ where: { leagueId, claimedByUserId: userId }, select: { externalId: true } })
    .catch(() => null)
  return espnTeamId(team?.externalId ?? null)
}

/**
 * The viewer's OPEN ESPN offers from the ledger, as views. `scanned` is false when the sweep has never
 * written this league — "no offers" and "not read yet" are different answers.
 */
export async function loadEspnOfferViewsForViewer(args: {
  leagueId: string
  userId: string
}): Promise<{ views: EspnOfferView[]; scanned: boolean; reason: string | null; viewerTeamId: string | null }> {
  const viewerTeamId = await viewerEspnTeamId(args.leagueId, args.userId)
  if (!viewerTeamId) {
    return { views: [], scanned: false, reason: 'claim your team in this league so we know whose offers to read', viewerTeamId: null }
  }
  const rows = (await prisma.providerTradeOffer
    .findMany({
      where: { leagueId: args.leagueId, provider: 'espn', status: 'pending', rosterIds: { has: viewerTeamId } },
      orderBy: [{ proposedAt: 'desc' }, { firstSeenAt: 'desc' }],
      select: {
        providerTradeId: true, status: true, proposedByRosterId: true, rosterIds: true, consentedRosterIds: true,
        proposedAt: true, firstSeenAt: true, expiresAt: true,
        assets: { select: { assetType: true, playerId: true, fromRosterId: true, toRosterId: true } },
      },
    })
    .catch(() => null)) as EspnLedgerRow[] | null
  if (rows == null) return { views: [], scanned: false, reason: 'ESPN offers could not be read just now', viewerTeamId }
  const anySeen = rows.length > 0 || (await prisma.providerTradeOffer
    .findFirst({ where: { leagueId: args.leagueId, provider: 'espn' }, select: { id: true } })
    .then(Boolean)
    .catch(() => false))
  // Past their stated expiry they are gone on ESPN, whether or not the sweep has caught up.
  const now = Date.now()
  const open = rows.filter((r) => !r.expiresAt || r.expiresAt.getTime() > now)
  const views = await viewsForRows({ leagueId: args.leagueId, rows: open, viewerTeamId })
  return {
    views,
    scanned: anySeen,
    reason: anySeen ? null : 'the ESPN offer sweep has not read this league yet',
    viewerTeamId,
  }
}

/** Rows → views, resolving every ESPN id once and naming teams from our own tables. */
export async function viewsForRows(args: {
  leagueId: string
  rows: readonly EspnLedgerRow[]
  viewerTeamId: string
}): Promise<EspnOfferView[]> {
  if (args.rows.length === 0) return []
  const ids = [...new Set(args.rows.flatMap((r) => r.assets.map((a) => a.playerId).filter((v): v is string => !!v)))]
  const found = await resolveTradePlayers(ids, { space: SPACE, sport: 'NFL', membershipCheckedLeagueId: args.leagueId }).catch(
    () => new Map<string, ResolvedTradePlayer>(),
  )
  const teams = await prisma.leagueTeam
    .findMany({ where: { leagueId: args.leagueId }, select: { externalId: true, teamName: true } })
    .catch(() => [] as Array<{ externalId: string; teamName: string }>)
  const nameByTeam = new Map(teams.map((t) => [espnTeamId(t.externalId), t.teamName?.trim() || null]))
  return buildEspnOfferViews({
    rows: args.rows,
    viewerTeamId: args.viewerTeamId,
    found,
    teamNameOf: (teamId) => nameByTeam.get(espnTeamId(teamId)) ?? null,
  })
}
