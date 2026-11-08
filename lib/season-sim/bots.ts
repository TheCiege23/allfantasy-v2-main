/**
 * Bot managers. Each persona turns what a real manager can see — ADP, past scored points, injury and bye
 * status — into lineup, waiver and trade decisions. Bots never read `SimPlayer.talent`.
 *
 * Bots only PROPOSE. Every claim and trade goes through the canonical runtime's own validation and
 * processing, which is the code under test.
 */
import type { CanonicalLeagueRules } from '@/lib/league-runtime'
import {
  buildCanonicalStarterSlots,
  type RosterRuntimePlayer,
  type RosterRuntimeSections,
} from '@/lib/roster-runtime/canonicalRosterRuntime'
import type { NflRedraftWaiverClaimInput } from '@/lib/waiver-runtime/canonicalNflRedraftWaiverRuntime'
import type { NflRedraftTradeAssetInput } from '@/lib/trade-runtime/canonicalNflRedraftTradeRuntime'
import { isOut, type InjuryBook, type SimPlayer } from './players'
import type { SimRng } from './rng'
import type { SimTeam } from './types'

export type ObservedPoints = Map<string, { total: number; games: number }>

export type BotView = {
  rules: CanonicalLeagueRules
  week: number
  team: SimTeam
  teams: SimTeam[]
  freeAgentIds: string[]
  playersById: Map<string, SimPlayer>
  injuries: InjuryBook
  observed: ObservedPoints
  rng: SimRng
  /** Per-run counter, so ids never depend on how many runs this process has done. */
  nextSequence: () => number
}

export function rosterPlayerFor(player: SimPlayer, week: number, injuries: InjuryBook): RosterRuntimePlayer {
  return {
    playerId: player.playerId,
    playerName: player.playerName,
    position: player.position,
    team: player.team,
    status: isOut(injuries, player.playerId, week) ? 'OUT' : 'ACTIVE',
    byeWeek: player.byeWeek,
    acquisitionType: null,
  }
}

export function allRosterIds(sections: RosterRuntimeSections): string[] {
  return [...sections.starters, ...sections.bench, ...sections.ir].map((player) => player.playerId)
}

/** What a manager would expect from a player: ADP-implied prior, pulled toward observed scoring. */
export function expectedPoints(view: Pick<BotView, 'playersById' | 'observed'>, playerId: string): number {
  const player = view.playersById.get(playerId)
  if (!player) return 0
  const prior = Math.max(1, 20 - player.adp / 12)
  const seen = view.observed.get(playerId)
  if (!seen || seen.games === 0) return prior
  const weight = Math.min(0.8, seen.games / 6)
  return prior * (1 - weight) + (seen.total / seen.games) * weight
}

function playable(view: BotView, player: RosterRuntimePlayer): boolean {
  return player.status !== 'OUT' && player.byeWeek !== view.week
}

function fillLineup(
  rules: CanonicalLeagueRules,
  players: RosterRuntimePlayer[],
  score: (player: RosterRuntimePlayer) => number,
): RosterRuntimeSections {
  const slots = buildCanonicalStarterSlots(rules)
  const remaining = [...players]
  const chosen: Array<RosterRuntimePlayer | null> = slots.map(() => null)
  const order = slots.map((_, index) => index).sort((a, b) => Number(slots[a]!.flexible) - Number(slots[b]!.flexible))
  for (const index of order) {
    const allowed = slots[index]!.allowedPositions.map((position) => position.toUpperCase())
    let best = -1
    for (let i = 0; i < remaining.length; i += 1) {
      if (!allowed.includes(remaining[i]!.position.toUpperCase())) continue
      if (best === -1 || score(remaining[i]!) > score(remaining[best]!)) best = i
    }
    if (best >= 0) chosen[index] = remaining.splice(best, 1)[0]!
  }
  return {
    starters: chosen.filter((player): player is RosterRuntimePlayer => Boolean(player)),
    bench: remaining,
    ir: [],
  }
}

/** Refreshes injury/bye status on the roster without moving anyone — what a ghost's lineup looks like. */
export function refreshStatuses(view: Pick<BotView, 'week' | 'playersById' | 'injuries'>, sections: RosterRuntimeSections): RosterRuntimeSections {
  const refresh = (player: RosterRuntimePlayer) => {
    const source = view.playersById.get(player.playerId)
    return source ? rosterPlayerFor(source, view.week, view.injuries) : player
  }
  return { starters: sections.starters.map(refresh), bench: sections.bench.map(refresh), ir: sections.ir.map(refresh) }
}

export function chooseLineup(view: BotView): RosterRuntimeSections {
  const current = refreshStatuses(view, view.team.sections)
  const all = [...current.starters, ...current.bench, ...current.ir]
  switch (view.team.persona) {
    case 'ghost':
      return current
    case 'tanker':
      // Inactive players first, then the weakest healthy ones.
      return fillLineup(view.rules, all, (player) => -(expectedPoints(view, player.playerId) + (playable(view, player) ? 100 : 0)))
    case 'chaos': {
      const noise = new Map(all.map((player) => [player.playerId, view.rng.next()]))
      return fillLineup(view.rules, all, (player) => noise.get(player.playerId)!)
    }
    case 'active':
    case 'colluder':
      return fillLineup(view.rules, all, (player) => expectedPoints(view, player.playerId) - (playable(view, player) ? 0 : 1000))
  }
}

function claimId(view: BotView, label: string): string {
  return `w${view.week}-${view.team.rosterId}-${label}-${view.nextSequence()}`
}

function claimFor(
  view: BotView,
  label: string,
  addPlayerId: string,
  dropPlayerId: string | null,
  bidAmount: number,
  priority: number,
  submittedAt: Date,
): NflRedraftWaiverClaimInput {
  const add = view.playersById.get(addPlayerId)
  const drop = dropPlayerId ? view.playersById.get(dropPlayerId) : null
  return {
    claimId: claimId(view, label),
    rosterId: view.team.rosterId,
    addPlayerId,
    addPlayerName: add?.playerName ?? addPlayerId,
    addPlayerPosition: add?.position ?? null,
    addPlayerTeam: add?.team ?? null,
    dropPlayerId,
    dropPlayerName: drop?.playerName ?? dropPlayerId,
    bidAmount,
    priority,
    conditionalRank: priority,
    status: 'pending',
    submittedAtIso: new Date(submittedAt.getTime() + priority * 1000).toISOString(),
    actorUserId: view.team.ownerId,
  }
}

export function chooseWaiverClaims(view: BotView, submittedAt: Date): NflRedraftWaiverClaimInput[] {
  const rostered = allRosterIds(view.team.sections)
  const freeAgents = [...view.freeAgentIds].sort((a, b) => expectedPoints(view, b) - expectedPoints(view, a))
  const balance = view.team.faabBalance
  switch (view.team.persona) {
    case 'ghost':
    case 'tanker':
      return []
    case 'active':
    case 'colluder': {
      const claims: NflRedraftWaiverClaimInput[] = []
      const droppable = [...rostered].sort((a, b) => expectedPoints(view, a) - expectedPoints(view, b))
      for (const add of freeAgents.slice(0, 6)) {
        if (claims.length >= 2) break
        const drop = droppable[claims.length]
        if (!drop) break
        if (expectedPoints(view, add) <= expectedPoints(view, drop) + 1.5) continue
        const bid = Math.min(balance, Math.round(balance * (0.02 + view.rng.next() * 0.18)))
        claims.push(claimFor(view, 'fair', add, drop, bid, claims.length + 1, submittedAt))
      }
      return claims
    }
    case 'chaos': {
      const claims: NflRedraftWaiverClaimInput[] = []
      const top = freeAgents[0]
      const drop = () => view.rng.pick(rostered)
      if (top) {
        claims.push(claimFor(view, 'all-in', top, drop(), balance, 1, submittedAt))
        claims.push(claimFor(view, 'double-spend', freeAgents[1] ?? top, drop(), balance, 2, submittedAt))
      }
      const otherTeams = view.teams.filter((team) => team.rosterId !== view.team.rosterId && team.eliminatedWeek == null)
      const otherRostered = otherTeams.flatMap((team) => allRosterIds(team.sections))
      // Each trick targets its OWN free agent: re-using `top` lets the duplicate-claim check reject the
      // claim first, and the FAAB / roster-size check the trick exists to probe never runs.
      const fresh = freeAgents.slice(2)
      const target = (i: number) => fresh[i] ?? null
      const tricks = view.rng.shuffle([
        () => (target(0) ? claimFor(view, 'overbid', target(0)!, drop(), balance + 25, 3, submittedAt) : null),
        () => (target(1) ? claimFor(view, 'negative-bid', target(1)!, drop(), -5, 4, submittedAt) : null),
        () => (otherRostered.length ? claimFor(view, 'rostered', view.rng.pick(otherRostered), drop(), 1, 5, submittedAt) : null),
        () => (target(2) && otherRostered.length ? claimFor(view, 'foreign-drop', target(2)!, view.rng.pick(otherRostered), 1, 6, submittedAt) : null),
        () => (target(3) ? claimFor(view, 'no-drop-full-roster', target(3)!, null, 1, 7, submittedAt) : null),
        () => claimFor(view, 'ghost-player', 'sim-nobody-000', drop(), 1, 8, submittedAt),
      ])
      for (const trick of tricks.slice(0, 3)) {
        const claim = trick()
        if (claim) claims.push(claim)
      }
      return claims
    }
  }
}

export type TradeIntent = {
  label: string
  proposerRosterId: string
  receiverRosterId: string
  assets: NflRedraftTradeAssetInput[]
  /** The receiver takes this long to accept; 1 means next week, which can cross the trade deadline. */
  acceptAfterWeeks: number
}

function playerAsset(view: BotView, from: string, to: string, playerId: string): NflRedraftTradeAssetInput {
  return {
    fromRosterId: from,
    toRosterId: to,
    assetType: 'player',
    playerId,
    playerName: view.playersById.get(playerId)?.playerName ?? playerId,
  }
}

export function chooseTrades(view: BotView): TradeIntent[] {
  const me = view.team
  const live = view.teams.filter((team) => team.rosterId !== me.rosterId && team.eliminatedWeek == null)
  if (!live.length) return []
  const mine = allRosterIds(me.sections)
  switch (me.persona) {
    case 'ghost':
    case 'tanker':
      return []
    case 'colluder': {
      const partner = live.find((team) => team.rosterId === me.partnerRosterId)
      if (!partner || !view.rng.chance(0.5)) return []
      const best = [...mine].sort((a, b) => expectedPoints(view, b) - expectedPoints(view, a))[0]
      const scrap = [...allRosterIds(partner.sections)].sort((a, b) => expectedPoints(view, a) - expectedPoints(view, b))[0]
      if (!best || !scrap) return []
      return [
        {
          label: 'collusion',
          proposerRosterId: me.rosterId,
          receiverRosterId: partner.rosterId,
          assets: [playerAsset(view, me.rosterId, partner.rosterId, best), playerAsset(view, partner.rosterId, me.rosterId, scrap)],
          acceptAfterWeeks: 0,
        },
      ]
    }
    case 'active': {
      if (!view.rng.chance(0.15)) return []
      const other = view.rng.pick(live)
      const theirs = allRosterIds(other.sections)
      const give = view.rng.pick(mine)
      const target = theirs.find((id) => Math.abs(expectedPoints(view, id) - expectedPoints(view, give)) < 2)
      if (!target) return []
      return [
        {
          label: 'fair',
          proposerRosterId: me.rosterId,
          receiverRosterId: other.rosterId,
          assets: [playerAsset(view, me.rosterId, other.rosterId, give), playerAsset(view, other.rosterId, me.rosterId, target)],
          acceptAfterWeeks: 0,
        },
      ]
    }
    case 'chaos': {
      const other = view.rng.pick(live)
      const theirs = allRosterIds(other.sections)
      const intents: TradeIntent[] = []
      const deadline = view.rules.trades.deadlineWeek ?? null
      // Proposed in deadline week, accepted the week after: the case a deadline check must still catch.
      if (deadline != null && view.week === deadline && mine.length && theirs.length) {
        intents.push({
          label: 'cross-deadline',
          proposerRosterId: me.rosterId,
          receiverRosterId: other.rosterId,
          assets: [playerAsset(view, me.rosterId, other.rosterId, view.rng.pick(mine)), playerAsset(view, other.rosterId, me.rosterId, view.rng.pick(theirs))],
          acceptAfterWeeks: 1,
        })
      }
      const trick = view.rng.int(0, 3)
      if (trick === 0 && theirs.length) {
        // Gives away a player it does not own.
        intents.push({
          label: 'not-owned',
          proposerRosterId: me.rosterId,
          receiverRosterId: other.rosterId,
          assets: [playerAsset(view, me.rosterId, other.rosterId, view.rng.pick(theirs))],
          acceptAfterWeeks: 0,
        })
      } else if (trick === 1 && mine.length) {
        intents.push({
          label: 'faab-overdraw',
          proposerRosterId: me.rosterId,
          receiverRosterId: other.rosterId,
          assets: [
            { fromRosterId: me.rosterId, toRosterId: other.rosterId, assetType: 'faab', faabAmount: me.faabBalance + 50, metadata: { amount: me.faabBalance + 50 } },
          ],
          acceptAfterWeeks: 0,
        })
      } else if (trick === 2 && mine.length >= 2 && theirs.length) {
        // Two-for-one: the receiver may go over the roster limit.
        intents.push({
          label: 'roster-overflow',
          proposerRosterId: me.rosterId,
          receiverRosterId: other.rosterId,
          assets: [
            playerAsset(view, me.rosterId, other.rosterId, mine[0]!),
            playerAsset(view, me.rosterId, other.rosterId, mine[1]!),
          ],
          acceptAfterWeeks: 0,
        })
      }
      return intents
    }
  }
}

/** Whether the receiving bot clicks accept. Ghosts never log in to see the offer. */
export function receiverAccepts(view: BotView, receiver: SimTeam, intent: TradeIntent): boolean {
  if (receiver.persona === 'ghost') return false
  if (intent.label === 'collusion') return receiver.partnerRosterId === intent.proposerRosterId
  if (receiver.persona === 'tanker' || receiver.persona === 'chaos') return true
  const gets = intent.assets.filter((asset) => asset.toRosterId === receiver.rosterId && asset.playerId)
  const gives = intent.assets.filter((asset) => asset.fromRosterId === receiver.rosterId && asset.playerId)
  const value = (ids: typeof gets) => ids.reduce((sum, asset) => sum + expectedPoints(view, asset.playerId!), 0)
  return value(gets) >= value(gives) - 0.5 || view.rng.chance(0.3)
}
