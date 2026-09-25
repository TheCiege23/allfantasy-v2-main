import 'server-only'

import { prisma } from '@/lib/prisma'
import { resolveRecipients } from '@/lib/notifications/resolveAppUserIds'
import type { PendingProviderTrade, PendingTradeAsset } from '@/lib/provider-trades/scanPendingSleeperTrades'
import {
  TRADE_OFFER_NOTE_MAX,
  type TradeOfferAsset,
  type TradeOfferCard,
  type TradeOfferSource,
} from './tradeOfferCard'
import { safeDisplayName } from './displayName'
import { postTradeOfferToDm, type PostTradeOfferInput, type TradeDmResult } from './tradeOfferDm'

/**
 * One card builder per place a trade offer comes from. Each returns what `postTradeOfferToDm`
 * needs — both managers as AllFantasy user ids, and the card — or null to skip.
 *
 * Every loader runs AFTER the offer's claim (see tradeOfferDm.ts), so a repeated call costs one
 * insert. Names are decoration: a lookup that fails costs a label, never the post.
 */

type Loaded = NonNullable<Awaited<ReturnType<PostTradeOfferInput['load']>>>

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function note(v: unknown): string | null {
  const s = str(v)
  if (!s) return null
  return s.length > TRADE_OFFER_NOTE_MAX ? `${s.slice(0, TRADE_OFFER_NOTE_MAX - 1)}…` : s
}

function pickLabel(season: number | null, round: number | null, fallback = 'Draft pick'): string {
  if (season && round) return `${season} Round ${round} pick`
  if (round) return `Round ${round} pick`
  return fallback
}

function playerDetail(position: string | null, team: string | null): string | null {
  const parts = [position, team].filter((p): p is string => Boolean(p && p !== '—'))
  return parts.length ? parts.join(' · ') : null
}

/** One AF user id for one member id (our id on a native league, a Sleeper id on an import). */
async function appUserIdFor(memberId: string | null | undefined): Promise<string | null> {
  if (!memberId || memberId.startsWith('orphan-')) return null
  const { userIds } = await resolveRecipients([memberId])
  return userIds[0] ?? null
}

async function namesFor(userIds: string[]): Promise<Map<string, string>> {
  const rows = await prisma.appUser
    .findMany({ where: { id: { in: userIds } }, select: { id: true, displayName: true, username: true } })
    .catch(() => [] as Array<{ id: string; displayName: string | null; username: string | null }>)
  return new Map(rows.map((r) => [r.id, safeDisplayName([r.displayName, r.username], 'A league mate')]))
}

async function leagueNameOf(leagueId: string): Promise<string | null> {
  const row = await prisma.league.findUnique({ where: { id: leagueId }, select: { name: true } }).catch(() => null)
  return str(row?.name)
}

// ── Native AF league (lib/league-trade-engine/tradeService.ts) ──────────────────────────────────

/**
 * ⚠ TWO TEAMS ONLY. A DM is between two people; a three-team trade has no single conversation to
 * land in, and posting it into one pair's DM would show that pair a deal the third manager is also
 * answering. Multi-team offers keep their bell/email/push notices and skip the DM.
 */
export async function loadNativeTradeOffer(tradeId: string): Promise<Loaded | null> {
  const trade = await prisma.afLeagueTrade.findUnique({ where: { id: tradeId }, include: { items: true } })
  if (!trade) return null
  const participants = new Set([
    trade.proposerRosterId,
    trade.receiverRosterId,
    ...trade.items.flatMap((i) => [i.fromRosterId, i.toRosterId]),
  ])
  if (participants.size !== 2) return null

  const rosters = await prisma.roster.findMany({
    where: { id: { in: [trade.proposerRosterId, trade.receiverRosterId] } },
    select: { id: true, platformUserId: true },
  })
  const receiverRoster = rosters.find((r) => r.id === trade.receiverRosterId)
  const proposerUserId = trade.proposedByUserId
  const receiverUserId = await appUserIdFor(receiverRoster?.platformUserId)
  if (!proposerUserId || !receiverUserId || proposerUserId === receiverUserId) return null

  const platformIds = rosters.map((r) => r.platformUserId).filter(Boolean)
  const [names, leagueName, teams] = await Promise.all([
    namesFor([proposerUserId, receiverUserId]),
    leagueNameOf(trade.leagueId),
    prisma.leagueTeam
      .findMany({
        where: {
          leagueId: trade.leagueId,
          OR: [
            { claimedByUserId: { in: [proposerUserId, receiverUserId] } },
            { platformUserId: { in: platformIds } },
            { externalId: { in: [trade.proposerRosterId, trade.receiverRosterId] } },
          ],
        },
        select: { claimedByUserId: true, platformUserId: true, externalId: true, teamName: true },
      })
      .catch(() => [] as Array<{ claimedByUserId: string | null; platformUserId: string | null; externalId: string; teamName: string }>),
  ])
  const teamNameFor = (rosterId: string, userId: string): string | null => {
    const platformUserId = rosters.find((r) => r.id === rosterId)?.platformUserId ?? null
    const team = teams.find(
      (t) => t.externalId === rosterId || t.claimedByUserId === userId || (platformUserId && t.platformUserId === platformUserId),
    )
    return str(team?.teamName)
  }

  const playerIds = trade.items
    .filter((i) => String(i.itemType).toLowerCase() === 'player' && i.itemReference)
    .filter((i) => !str(obj(i.metadata).playerName) && !str(obj(i.metadata).name))
    .map((i) => i.itemReference as string)
  const players = playerIds.length
    ? await prisma.sportsPlayer
        .findMany({ where: { sleeperId: { in: playerIds } }, select: { sleeperId: true, name: true, position: true, team: true } })
        .catch(() => [] as Array<{ sleeperId: string | null; name: string; position: string | null; team: string | null }>)
    : []
  const playerById = new Map<string, { name: string; position: string | null; team: string | null }>()
  for (const p of players) if (p.sleeperId && !playerById.has(p.sleeperId)) playerById.set(p.sleeperId, p)

  const label = (item: (typeof trade.items)[number]): TradeOfferAsset => {
    const meta = obj(item.metadata)
    const type = String(item.itemType ?? 'player').toLowerCase()
    if (type === 'faab') return { label: `$${item.faabAmount ?? num(meta.amount) ?? 0} FAAB` }
    if (type.includes('pick')) {
      const fallback = type === 'devy_pick' ? 'Devy pick' : 'Draft pick'
      return { label: pickLabel(num(meta.pickSeason ?? meta.season), num(meta.pickRound ?? meta.round), fallback) }
    }
    if (type === 'player') {
      const known = item.itemReference ? playerById.get(item.itemReference) : undefined
      const name = str(meta.playerName) ?? str(meta.name) ?? known?.name ?? 'Unknown player'
      return { label: name, detail: playerDetail(str(meta.position) ?? known?.position ?? null, str(meta.team) ?? known?.team ?? null) }
    }
    return { label: str(meta.label) ?? str(meta.name) ?? 'Special asset' }
  }

  const card: TradeOfferCard = {
    v: 1,
    source: 'native',
    tradeId: trade.id,
    leagueId: trade.leagueId,
    leagueName,
    proposer: {
      manager: names.get(proposerUserId) ?? 'A league mate',
      team: teamNameFor(trade.proposerRosterId, proposerUserId),
      gives: trade.items.filter((i) => i.fromRosterId === trade.proposerRosterId).map(label),
    },
    receiver: {
      manager: names.get(receiverUserId) ?? 'A league mate',
      team: teamNameFor(trade.receiverRosterId, receiverUserId),
      gives: trade.items.filter((i) => i.fromRosterId === trade.receiverRosterId).map(label),
    },
    note: note(obj(trade.metadata).offerMessage),
    status: 'pending',
    href: `/league/${encodeURIComponent(trade.leagueId)}?view=trades&tradeId=${encodeURIComponent(trade.id)}`,
    hrefs: null,
    directionKnown: true,
    answerOn: null,
    createdAt: new Date(trade.createdAt ?? Date.now()).toISOString(),
  }
  return { card, proposerUserId, receiverUserId, postAsUserId: proposerUserId }
}

// ── Redraft trade center (app/api/redraft/trade-proposals) ───────────────────────────────────────

export async function loadRedraftTradeOffer(proposalId: string): Promise<Loaded | null> {
  const proposal = await prisma.redraftTradeProposal.findUnique({ where: { id: proposalId }, include: { assets: true } })
  if (!proposal) return null
  const rosters = await prisma.redraftRoster.findMany({
    where: { id: { in: [proposal.proposerRosterId, proposal.receiverRosterId] } },
    select: { id: true, ownerId: true, ownerName: true, teamName: true },
  })
  const proposer = rosters.find((r) => r.id === proposal.proposerRosterId)
  const receiver = rosters.find((r) => r.id === proposal.receiverRosterId)
  if (!proposer?.ownerId || !receiver?.ownerId || proposer.ownerId === receiver.ownerId) return null
  const [names, leagueName] = await Promise.all([
    namesFor([proposer.ownerId, receiver.ownerId]),
    leagueNameOf(proposal.leagueId),
  ])

  const label = (a: (typeof proposal.assets)[number]): TradeOfferAsset => {
    const meta = obj(a.metadata)
    switch (a.assetType) {
      case 'draft_pick':
        return { label: pickLabel(a.pickSeason ?? null, a.pickRound ?? null) }
      case 'faab':
        return { label: `$${num(meta.amount) ?? 0} FAAB` }
      case 'future_consideration':
        return { label: 'Future considerations' }
      default:
        return {
          label: str(a.playerName) ?? 'Unknown player',
          detail: playerDetail(str(meta.position), str(meta.team)),
        }
    }
  }

  const card: TradeOfferCard = {
    v: 1,
    source: 'redraft',
    tradeId: proposal.id,
    leagueId: proposal.leagueId,
    leagueName,
    proposer: {
      manager: names.get(proposer.ownerId) ?? safeDisplayName([proposer.ownerName], 'A league mate'),
      team: str(proposer.teamName),
      gives: proposal.assets.filter((a) => a.fromRosterId === proposer.id).map(label),
    },
    receiver: {
      manager: names.get(receiver.ownerId) ?? safeDisplayName([receiver.ownerName], 'A league mate'),
      team: str(receiver.teamName),
      gives: proposal.assets.filter((a) => a.fromRosterId === receiver.id).map(label),
    },
    note: note(proposal.reason),
    status: 'pending',
    href: `/league/${encodeURIComponent(proposal.leagueId)}?view=trades`,
    hrefs: null,
    directionKnown: true,
    answerOn: null,
    createdAt: new Date(proposal.createdAt ?? Date.now()).toISOString(),
  }
  return { card, proposerUserId: proposer.ownerId, receiverUserId: receiver.ownerId, postAsUserId: proposer.ownerId }
}

// ── Live-draft pick trades (app/api/leagues/[leagueId]/draft/trade-proposals) ────────────────────

export async function loadDraftPickTradeOffer(input: {
  leagueId: string
  proposalId: string
  proposerUserId: string
  receiverRosterId: string
}): Promise<Loaded | null> {
  const proposal = await prisma.draftPickTradeProposal.findUnique({ where: { id: input.proposalId } })
  if (!proposal) return null
  const roster = await prisma.roster
    .findUnique({ where: { id: input.receiverRosterId }, select: { platformUserId: true } })
    .catch(() => null)
  const receiverUserId = await appUserIdFor(roster?.platformUserId)
  if (!receiverUserId || receiverUserId === input.proposerUserId) return null
  const [names, leagueName] = await Promise.all([
    namesFor([input.proposerUserId, receiverUserId]),
    leagueNameOf(input.leagueId),
  ])
  const pick = (round: number, slot: number): TradeOfferAsset => ({ label: `Round ${round}, pick ${slot}` })
  const card: TradeOfferCard = {
    v: 1,
    source: 'draft_pick',
    tradeId: proposal.id,
    leagueId: input.leagueId,
    leagueName,
    proposer: {
      manager: names.get(input.proposerUserId) ?? safeDisplayName([proposal.proposerName], 'A league mate'),
      team: str(proposal.proposerName),
      gives: [pick(proposal.giveRound, proposal.giveSlot)],
    },
    receiver: {
      manager: names.get(receiverUserId) ?? safeDisplayName([proposal.receiverName], 'A league mate'),
      team: str(proposal.receiverName),
      gives: [pick(proposal.receiveRound, proposal.receiveSlot)],
    },
    note: null,
    status: 'pending',
    href: `/league/${encodeURIComponent(input.leagueId)}?tab=Draft`,
    hrefs: null,
    directionKnown: true,
    answerOn: null,
    createdAt: new Date(proposal.createdAt ?? Date.now()).toISOString(),
  }
  return { card, proposerUserId: input.proposerUserId, receiverUserId, postAsUserId: input.proposerUserId }
}

// ── Imported leagues (Sleeper sweep, Yahoo scan) ─────────────────────────────────────────────────

export function providerAssetLabel(a: PendingTradeAsset): TradeOfferAsset {
  if (typeof a.faabAmount === 'number') return { label: `$${a.faabAmount} FAAB` }
  if (a.isPick) return { label: str(a.pickRound) ?? pickLabel(a.pickYear ?? null, a.pickRoundNumber ?? null) }
  return { label: str(a.playerName) ?? 'Unknown player', detail: playerDetail(str(a.position), str(a.team)) }
}

/** An offer's id is only unique inside its provider league, so the key carries both. */
export function importedTradeId(providerLeagueId: string, transactionId: string): string {
  return `${providerLeagueId}:${transactionId}`
}

export type ImportedOfferSide = {
  userId: string
  manager: string
  team?: string | null
  gives: TradeOfferAsset[]
  /** This manager's own copy of the league. */
  href: string
}

/**
 * Post one imported-league offer. Both sides must already be resolved to AllFantasy users — the
 * caller is where "only the recipient is on AllFantasy" gets decided, and it must not call this.
 */
export function postImportedOfferToDm(input: {
  provider: 'sleeper' | 'yahoo'
  providerLeagueId: string
  transactionId: string
  leagueId: string
  leagueName: string | null
  proposer: ImportedOfferSide
  receiver: ImportedOfferSide
  /** False for Yahoo, whose payload does not say who offered. */
  directionKnown: boolean
  createdAt?: string | null
}): Promise<TradeDmResult> {
  const source: TradeOfferSource = input.provider
  const tradeId = importedTradeId(input.providerLeagueId, input.transactionId)
  return postTradeOfferToDm({
    source,
    tradeId,
    load: async () => {
      if (!input.proposer.userId || !input.receiver.userId || input.proposer.userId === input.receiver.userId) return null
      const card: TradeOfferCard = {
        v: 1,
        source,
        tradeId,
        leagueId: input.leagueId,
        leagueName: input.leagueName,
        proposer: { manager: input.proposer.manager, team: input.proposer.team ?? null, gives: input.proposer.gives },
        receiver: { manager: input.receiver.manager, team: input.receiver.team ?? null, gives: input.receiver.gives },
        note: null,
        status: 'pending',
        href: input.proposer.href,
        hrefs: { [input.proposer.userId]: input.proposer.href, [input.receiver.userId]: input.receiver.href },
        directionKnown: input.directionKnown,
        answerOn: input.provider,
        createdAt: input.createdAt ?? new Date().toISOString(),
      }
      return {
        card,
        proposerUserId: input.proposer.userId,
        receiverUserId: input.receiver.userId,
        postAsUserId: input.directionKnown ? input.proposer.userId : null,
      }
    },
  })
}

/**
 * Yahoo pending offers, as read by the league Trades panel for ONE viewer.
 *
 * ⚠ THE VIEWER'S SIDE IS KNOWN, THE PROPOSER IS NOT. Yahoo's payload names both teams but not who
 * offered (see scanPendingYahooTrades), so the card is direction-neutral and posted as a system
 * message rather than put in either manager's mouth.
 *
 * The other manager is found through ANY AllFantasy copy of the same Yahoo league whose team with
 * that key is claimed — imported leagues are one row per importer, so their claim is usually on
 * their own row, not the viewer's. No claim anywhere means they are not on AllFantasy: skipped.
 */
export async function postYahooOffersToDms(input: {
  leagueId: string
  platformLeagueId: string
  viewerUserId: string
  trades: PendingProviderTrade[]
}): Promise<TradeDmResult[]> {
  const results: TradeDmResult[] = []
  const pending = input.trades.filter(
    (t) => t.provider === 'yahoo' && t.lifecycleStatus !== 'complete' && t.viewerRosterExternalId && t.counterpartyRosterExternalId,
  )
  if (pending.length === 0) return results
  const leagueName = await leagueNameOf(input.leagueId)

  for (const t of pending) {
    results.push(
      await postTradeOfferToDm({
        source: 'yahoo',
        tradeId: importedTradeId(input.platformLeagueId, t.transactionId),
        load: async () => {
          const [mine, theirs] = await Promise.all([
            prisma.leagueTeam.findFirst({
              where: { leagueId: input.leagueId, externalId: t.viewerRosterExternalId!, claimedByUserId: input.viewerUserId },
              select: { teamName: true },
            }),
            prisma.leagueTeam.findFirst({
              where: {
                externalId: t.counterpartyRosterExternalId!,
                claimedByUserId: { not: null },
                league: { platform: 'yahoo', platformLeagueId: input.platformLeagueId },
              },
              select: { claimedByUserId: true, teamName: true, leagueId: true },
            }),
          ])
          const otherUserId = theirs?.claimedByUserId ?? null
          if (!otherUserId || otherUserId === input.viewerUserId) return null
          const names = await namesFor([input.viewerUserId, otherUserId])
          const card: TradeOfferCard = {
            v: 1,
            source: 'yahoo',
            tradeId: importedTradeId(input.platformLeagueId, t.transactionId),
            leagueId: input.leagueId,
            leagueName,
            proposer: {
              manager: str(mine?.teamName) ?? names.get(input.viewerUserId) ?? 'Your team',
              team: str(mine?.teamName),
              gives: t.assetsGiven.map(providerAssetLabel),
            },
            receiver: {
              manager: str(theirs?.teamName) ?? names.get(otherUserId) ?? 'Their team',
              team: str(theirs?.teamName),
              gives: t.assetsReceived.map(providerAssetLabel),
            },
            note: null,
            status: 'pending',
            href: `/league/${encodeURIComponent(input.leagueId)}?view=trades`,
            hrefs: {
              [input.viewerUserId]: `/league/${encodeURIComponent(input.leagueId)}?view=trades`,
              [otherUserId]: `/league/${encodeURIComponent(theirs!.leagueId)}?view=trades`,
            },
            directionKnown: false,
            answerOn: 'yahoo',
            createdAt: t.proposedAt ?? new Date().toISOString(),
          }
          return { card, proposerUserId: input.viewerUserId, receiverUserId: otherUserId, postAsUserId: null }
        },
      }).catch(() => ({ posted: false as const, reason: 'post_failed' as const })),
    )
  }
  return results
}
