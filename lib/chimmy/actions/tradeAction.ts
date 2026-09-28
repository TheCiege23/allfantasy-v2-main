import 'server-only'

import { prisma } from '@/lib/prisma'
import { createAfLeagueTrade } from '@/lib/league-trade-engine/tradeService'
import { resolveLeagueTradeSettings, isPastTradeDeadline } from '@/lib/league-trade-engine/tradeSettingsResolver'
import { validateTradeAssets } from '@/lib/league-trade-engine/tradeValidationService'
import type { TradeAssetInput } from '@/lib/league-trade-engine/types'
import { isSportsDataEnabled } from '@/lib/sports-evidence/gates'
import { CertifiedTradeIntegrationService, extractTradePlayerRefs } from '@/lib/sports-evidence/tradeIntegration'
import { signChimmyActionToken } from './actionToken'
import { describeRosterPlayers, displayName, loadActionScope, loadOwnRoster, type RosterPlayerInfo } from './nativeActionScope'
import { findByName, indexByName } from './nameMatch'
import type { ActionCardPlayer, ChimmyActionCard, ChimmyActionTokenPayload, TradeAssetSpec } from './types'

/**
 * "Send this trade" for a native league — PROPOSE builds a confirm card; EXECUTE (only from the
 * confirm route, only after the user's tap) creates the offer through `createAfLeagueTrade`, the
 * same service the Trade Center's POST uses, with all of its validation: lifecycle, ownership of
 * the proposing roster, roster-transaction gates, trade settings, the deadline, every asset on the
 * roster that sends it, and the counter/notification plumbing.
 *
 * ⚠ SENDING AN OFFER IS NOT MAKING A TRADE. The other manager still accepts or declines, and the
 * league's own review (commissioner / vote) still applies. The card says so.
 *
 * ⚠ THE DEADLINE IS ACTUALLY CHECKED HERE. `createAfLeagueTrade` checks the deadline against
 * `currentWeek`, and the Trade Center route never passes one — so through that route the deadline
 * check is a no-op. Chimmy passes the league's week, so a Chimmy offer past the deadline is refused.
 *
 * Players only. Picks and FAAB need ids the model cannot see; the card says to use the Trade Center.
 */

type Outcome = { ok: true; text: string; card: ChimmyActionCard } | { ok: false; text: string }

const INJURY_FLAG = /^(out|o|ir|injured reserve|doubtful|d|questionable|q|pup|suspended|sus|nfi|dnr)$/i
const MAX_SIDE = 5

const REVIEW_NOTE: Record<string, string> = {
  instant: 'If they accept, it processes under your league settings with no review.',
  commissioner: 'If they accept, your commissioner reviews it before it processes.',
  league_vote: 'If they accept, the league votes on it before it processes.',
}

function namesList(value: unknown): string[] {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
  return list.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map((s) => s.trim().slice(0, 80))
}

type RosterRow = { id: string; platformUserId: string; playerData: unknown }

async function teamNameFor(leagueId: string, platformUserId: string): Promise<string> {
  const [team, user] = await Promise.all([
    prisma.leagueTeam.findFirst({ where: { leagueId, platformUserId }, select: { teamName: true } }).catch(() => null),
    prisma.appUser.findUnique({ where: { id: platformUserId }, select: { displayName: true, username: true } }).catch(() => null),
  ])
  return team?.teamName?.trim() || user?.displayName?.trim() || user?.username?.trim() || 'their team'
}

async function isAppUser(id: string): Promise<boolean> {
  if (!id || id.startsWith('orphan-')) return false
  const row = await prisma.appUser.findUnique({ where: { id }, select: { id: true } }).catch(() => null)
  return Boolean(row)
}

export async function proposeTrade(args: { leagueId: string; userId: string; give: unknown; get: unknown; now?: Date }): Promise<Outcome> {
  const now = args.now ?? new Date()
  const give = namesList(args.give)
  const get = namesList(args.get)
  if (give.length === 0 || get.length === 0) {
    return { ok: false, text: 'NO CARD WAS MADE: a trade needs what the user GIVES and what they GET, as full player names. Ask for the missing side.' }
  }
  if (give.length > MAX_SIDE || get.length > MAX_SIDE) {
    return { ok: false, text: `NO CARD WAS MADE: Chimmy can send up to ${MAX_SIDE} players a side. For a bigger deal, use the Trade Center.` }
  }
  if ([...give, ...get].some((n) => /\d/.test(n))) {
    return {
      ok: false,
      text: 'NO CARD WAS MADE: Chimmy can only put PLAYERS in an offer right now — draft picks and FAAB are added in the Trade Center. Say so; offer to send the player part, or point them there.',
    }
  }

  const scope = await loadActionScope(args.leagueId, args.userId, 'trade')
  if (!scope.ok) return { ok: false, text: scope.message }
  const { league, week, season } = scope

  const mine = await loadOwnRoster(league.id, args.userId)
  if (!mine) return { ok: false, text: "NO CARD WAS MADE: the user doesn't have a team in this league." }

  const rosters = (await prisma.roster
    .findMany({ where: { leagueId: league.id }, select: { id: true, platformUserId: true, playerData: true } })
    .catch(() => [])) as RosterRow[]
  const infoByRoster = new Map<string, Map<string, RosterPlayerInfo>>()
  await Promise.all(
    rosters.map(async (r) => infoByRoster.set(r.id, await describeRosterPlayers(String(league.sport), r.playerData))),
  )

  const myIndex = indexByName(infoByRoster.get(mine.id)?.values() ?? [])
  const giveIds: string[] = []
  for (const n of give) {
    const hits = findByName(myIndex, n)
    if (hits.length !== 1) {
      return {
        ok: false,
        text: hits.length === 0
          ? `NO CARD WAS MADE: "${n}" is not on the user's roster. Ask them to check the name.`
          : `NO CARD WAS MADE: "${n}" matches ${hits.length} players on their roster. Ask which one.`,
      }
    }
    giveIds.push(hits[0]!.playerId)
  }

  const others = rosters.filter((r) => r.id !== mine.id)
  const getHits: Array<{ name: string; hits: Array<{ rosterId: string; playerId: string }> }> = get.map((n) => ({
    name: n,
    hits: others.flatMap((r) =>
      findByName(indexByName(infoByRoster.get(r.id)?.values() ?? []), n).map((p) => ({ rosterId: r.id, playerId: p.playerId })),
    ),
  }))
  const missing = getHits.find((g) => g.hits.length === 0)
  if (missing) {
    return { ok: false, text: `NO CARD WAS MADE: "${missing.name}" is not on another team in this league (or is a free agent). Ask them to check.` }
  }
  const ambiguous = getHits.find((g) => g.hits.length > 1)
  if (ambiguous) return { ok: false, text: `NO CARD WAS MADE: "${ambiguous.name}" matches players on more than one team. Ask which one.` }
  const partnerIds = new Set(getHits.map((g) => g.hits[0]!.rosterId))
  if (partnerIds.size !== 1) {
    return { ok: false, text: 'NO CARD WAS MADE: everything the user gets must come from ONE other team. Split it into separate offers.' }
  }
  const partner = others.find((r) => r.id === [...partnerIds][0])!
  if (!(await isAppUser(partner.platformUserId))) {
    return { ok: false, text: "NO CARD WAS MADE: that team has no AllFantasy manager to receive an offer (it's open or unclaimed). Say so." }
  }
  const getIds = getHits.map((g) => g.hits[0]!.playerId)

  const assets: TradeAssetSpec[] = [
    ...giveIds.map((id) => ({ playerId: id, fromRosterId: mine.id, toRosterId: partner.id })),
    ...getIds.map((id) => ({ playerId: id, fromRosterId: partner.id, toRosterId: mine.id })),
  ]

  /* Pre-flight with the engine's own validator, so a card is never offered for a trade that must fail. */
  const settings = resolveLeagueTradeSettings(league)
  const [proposerRow, receiverRow] = await Promise.all([
    prisma.roster.findFirst({ where: { id: mine.id, leagueId: league.id } }),
    prisma.roster.findFirst({ where: { id: partner.id, leagueId: league.id } }),
  ])
  if (!proposerRow || !receiverRow) return { ok: false, text: 'NO CARD WAS MADE: the rosters could not be loaded.' }
  if (isPastTradeDeadline(league, week)) return { ok: false, text: 'NO CARD WAS MADE: this league\'s trade deadline has passed. Say so.' }
  const v = validateTradeAssets({
    league,
    settings,
    proposer: proposerRow,
    receiver: receiverRow,
    participants: [proposerRow, receiverRow],
    assets: toEngineAssets(assets),
    currentWeek: week,
  })
  if (!v.ok) return { ok: false, text: `NO CARD WAS MADE: ${v.message} Say so plainly.` }

  const signed = signChimmyActionToken({
    userId: args.userId,
    leagueId: league.id,
    spec: { kind: 'trade', proposerRosterId: mine.id, receiverRosterId: partner.id, week, season, assets },
    now,
  })
  if (!signed) return { ok: false, text: 'Chimmy cannot prepare a confirm card right now (signing is not configured). Say so; nothing was sent.' }

  const partnerName = await teamNameFor(league.id, partner.platformUserId)
  const card = (rosterId: string, id: string): ActionCardPlayer => {
    const p = infoByRoster.get(rosterId)?.get(id)
    return { name: displayName(p ?? { playerId: id, name: null }), position: p?.position ?? null, team: p?.team ?? null }
  }
  const warnings: string[] = []
  for (const [rosterId, id] of [...giveIds.map((id) => [mine.id, id]), ...getIds.map((id) => [partner.id, id])] as Array<[string, string]>) {
    const status = infoByRoster.get(rosterId)?.get(id)?.status
    if (status && INJURY_FLAG.test(status.trim())) warnings.push(`${card(rosterId, id).name} is listed ${status}.`)
  }
  if (getIds.length > giveIds.length) {
    warnings.push(`You'd receive ${getIds.length - giveIds.length} more player${getIds.length - giveIds.length === 1 ? '' : 's'} than you send — you may need to drop someone to fit.`)
  }
  warnings.push(`${partnerName} has to accept. The offer expires in 48 hours if they don't answer.`)

  const actionCard: ChimmyActionCard = {
    actionId: signed.payload.actionId,
    kind: 'trade',
    token: signed.token,
    title: `Trade offer to ${partnerName}`,
    league: { id: league.id, name: league.name ?? null, sport: String(league.sport) },
    week,
    season,
    expiresAt: new Date(signed.payload.exp * 1000).toISOString(),
    trade: {
      partnerTeamName: partnerName,
      youGive: giveIds.map((id) => card(mine.id, id)),
      youGet: getIds.map((id) => card(partner.id, id)),
      reviewNote: REVIEW_NOTE[settings.tradeReviewMode] ?? null,
    },
    warnings,
  }

  const text = [
    `CONFIRMATION CARD READY — NOTHING HAS BEEN SENT. Trade offer in "${league.name ?? 'this league'}" to ${partnerName}:`,
    `the user GIVES ${actionCard.trade!.youGive.map((p) => p.name).join(', ')} and GETS ${actionCard.trade!.youGet.map((p) => p.name).join(', ')}.`,
    `Warnings on the card: ${warnings.join(' ')}`,
    'A card with a Confirm button appears under your answer. The offer is sent ONLY if the user taps Confirm, and the card expires in 10 minutes.',
    'Say what the offer is and that it needs their tap. Never say the trade was sent, made or accepted. If you have not graded it, offer to (evaluate_trade).',
  ].join(' ')
  return { ok: true, text, card: actionCard }
}

function toEngineAssets(assets: TradeAssetSpec[]): TradeAssetInput[] {
  return assets.map((a) => ({ itemType: 'player', itemReference: a.playerId, fromRosterId: a.fromRosterId, toRosterId: a.toRosterId }))
}

export type TradeExecuteResult = { ok: true; message: string; tradeId: string } | { ok: false; message: string }

/** Runs ONLY from the confirm route, after the token verified and the action id was claimed. */
export async function executeTradeAction(payload: ChimmyActionTokenPayload, userId: string): Promise<TradeExecuteResult> {
  const spec = payload.spec
  if (spec.kind !== 'trade') return { ok: false, message: 'Not a trade action.' }

  const scope = await loadActionScope(payload.leagueId, userId, 'trade')
  if (!scope.ok) return { ok: false, message: scope.message }
  const { league } = scope

  const mine = await loadOwnRoster(league.id, userId)
  if (!mine || mine.id !== spec.proposerRosterId) return { ok: false, message: "That trade card isn't for your team in this league." }
  const partner = await prisma.roster
    .findFirst({ where: { id: spec.receiverRosterId, leagueId: league.id }, select: { platformUserId: true } })
    .catch(() => null)
  if (!partner || !(await isAppUser(partner.platformUserId))) {
    return { ok: false, message: 'Nothing was sent: that team no longer has an AllFantasy manager to receive it.' }
  }
  for (const a of spec.assets) {
    const ours = a.fromRosterId === spec.proposerRosterId && a.toRosterId === spec.receiverRosterId
    const theirs = a.fromRosterId === spec.receiverRosterId && a.toRosterId === spec.proposerRosterId
    if (!ours && !theirs) return { ok: false, message: 'Nothing was sent: the card does not describe a two-team trade.' }
  }
  const assets = toEngineAssets(spec.assets)

  /* The Trade Center's certified gate, same behaviour: NFL, flag-gated, reject-only, never invents a lock. */
  if (isSportsDataEnabled('trade') && String(league.sport ?? 'NFL').toUpperCase() === 'NFL') {
    try {
      const guard = await new CertifiedTradeIntegrationService().evaluateTradeProposalSafety({
        season: String(spec.season),
        week: String(spec.week),
        players: extractTradePlayerRefs(assets.map((a) => ({ itemType: a.itemType, itemReference: a.itemReference }))),
        enforcePlayerLock: false,
      })
      if (guard.block) return { ok: false, message: `Nothing was sent: trade blocked by certified game evidence (${guard.reason}).` }
    } catch {
      /* fail-open, as the Trade Center does */
    }
  }

  try {
    const { id } = await createAfLeagueTrade({
      leagueId: league.id,
      proposedByUserId: userId,
      proposerRosterId: spec.proposerRosterId,
      receiverRosterId: spec.receiverRosterId,
      assets,
      currentWeek: scope.week,
      metadata: { source: 'chimmy', chimmyActionId: payload.actionId },
    })
    return { ok: true, tradeId: id, message: 'Offer sent — they will see it in their Trades tab.' }
  } catch (e) {
    return { ok: false, message: `Nothing was sent: ${e instanceof Error ? e.message : 'the trade could not be created.'}` }
  }
}
