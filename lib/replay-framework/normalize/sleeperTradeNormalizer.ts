/**
 * Decision OS Replay Framework — Sleeper trade normalizer.
 * Converts a real, raw `SleeperTransaction` (lib/sleeper-client.ts) plus its
 * league/roster/user/player context into the generic `ReplayImportInput`
 * shape (decisionType: 'trade'), per docs/SLEEPER_TRADE_REPLAY_ARCHITECTURE_ADR.md.
 *
 * Reuses the exact same valuation convention already established by
 * lib/league-trade-engine/tradeLearningCapture.ts's resolveItemValue() (a
 * conservative flat fallback for any unresolvable asset) rather than
 * inventing new valuation logic — that function is module-private there and
 * this module intentionally does not modify live trade capture code, so a
 * small, parallel copy is used here instead.
 */
import { findPlayerBySleeperId, getPickValue, type FantasyCalcPlayer } from '@/lib/fantasycalc'
import type { LeagueRosterConfig } from '@/lib/vorp-engine'
import type {
  SleeperLeague,
  SleeperRoster,
  SleeperTransaction,
  SleeperUser,
} from '@/lib/sleeper-client'
import { getPlayerName } from '@/lib/sleeper-client'
import type { ReplayImportInput, TradeReplayPayload, TradeReplayRosterAsset } from '../types'
import { deriveLeagueRosterConfig, resolvePlayerVorp } from '../valuation/vorpResolver'

const REPLAY_FALLBACK_VALUE = 200

type PlayerDirectory = Record<string, { full_name?: string; first_name?: string; last_name?: string; position?: string }>

interface ResolvedAsset {
  name: string
  value: number
  type: 'player' | 'pick'
  pos?: string
  vorpValue?: number
  providerAssetId: string
}

function resolveDropOrAddAsset(
  playerId: string,
  players: PlayerDirectory,
  fcPlayers: FantasyCalcPlayer[],
  rosterConfig: LeagueRosterConfig,
): ResolvedAsset {
  const fc = findPlayerBySleeperId(fcPlayers, playerId)
  return {
    name: fc?.player.name ?? getPlayerName(players as any, playerId),
    value: fc?.value ?? REPLAY_FALLBACK_VALUE,
    type: 'player',
    // Position is required for computeTradeDrivers()'s roster-context lineup
    // math (computeBestLineupPPG() only counts a player with a real `pos`) —
    // prefer FantasyCalc's own position, fall back to Sleeper's player
    // directory, matching the same fallback-chain convention used for value.
    pos: fc?.player.position ?? players[playerId]?.position,
    // vorpValue (Phase 7) — reuses the same computePlayerVorp() primitive
    // native trade flows call; 0 for any player that doesn't resolve against
    // FantasyCalc, matching this pipeline's established graceful-fallback
    // convention (never fabricated, never blocks the rest of the trade).
    vorpValue: resolvePlayerVorp(fc, rosterConfig, fcPlayers),
    // The stable, real Sleeper player ID (Phase 9) — see TradeReplayRosterAsset's
    // docstring in ../types.ts for why this must be threaded through
    // consistently rather than assigned a fresh synthetic ID downstream.
    providerAssetId: playerId,
  }
}

/**
 * Resolves a roster's full real player list (Sleeper's own `players: string[]`
 * on the roster, not just the traded assets) into trade-engine-ready assets,
 * for `computeTradeDrivers()`'s roster-context lineup math (Phase 6, per
 * docs/SLEEPER_TRADE_REPLAY_ARCHITECTURE_ADR.md §11). Additive — a roster
 * with no resolvable players simply yields an empty array, which the
 * backtest executor already treats the same as "no roster context."
 */
function resolveFullRoster(
  roster: SleeperRoster | undefined,
  players: PlayerDirectory,
  fcPlayers: FantasyCalcPlayer[],
  rosterConfig: LeagueRosterConfig,
): TradeReplayRosterAsset[] {
  if (!roster) return []
  return (roster.players ?? []).map((playerId) => {
    const asset = resolveDropOrAddAsset(playerId, players, fcPlayers, rosterConfig)
    return { name: asset.name, value: asset.value, type: asset.type, pos: asset.pos, vorpValue: asset.vorpValue, providerAssetId: asset.providerAssetId }
  })
}

function resolvePickAsset(pick: SleeperTransaction['draft_picks'][number], isDynasty: boolean): ResolvedAsset {
  const season = Number(pick.season)
  const round = pick.round
  const value = Number.isFinite(season) && Number.isFinite(round) ? getPickValue(season, round, isDynasty) : REPLAY_FALLBACK_VALUE
  // Deterministic pick identifier — stable across the give/receive vs.
  // roster-context boundary the same way a real player ID is, though picks
  // never appear in `proposerRoster`/`counterpartyRoster` (those are built
  // from Sleeper's own `roster.players`, which lists players only).
  const providerAssetId = `pick-${pick.season}-r${pick.round}-${pick.roster_id}`
  return { name: `${pick.season} Round ${pick.round} pick`, value, type: 'pick', providerAssetId }
}

/** Normalizes Sleeper's `complete`|`pending`|`failed` into our own trade-outcome vocabulary, per docs/TRADE_LEARNING_CAPTURE_ARCHITECTURE_ADR.md Decision 2's mapping convention (reused, not reinvented). */
export function mapSleeperStatusToOutcome(status: string): 'ACCEPTED' | 'REJECTED' | 'COUNTERED' | 'UNKNOWN' {
  if (status === 'complete') return 'ACCEPTED'
  if (status === 'failed') return 'REJECTED'
  return 'UNKNOWN'
}

export function normalizeSleeperTrade(input: {
  transaction: SleeperTransaction
  league: SleeperLeague
  rosters: SleeperRoster[]
  users: SleeperUser[]
  players: PlayerDirectory
  fcPlayers: FantasyCalcPlayer[]
  ingestSourceUserId: string
  providerWeek: number | null
}): ReplayImportInput {
  const { transaction: tx, league, rosters, users, players, fcPlayers, ingestSourceUserId, providerWeek } = input

  const rosterById = new Map(rosters.map((r) => [r.roster_id, r]))
  const rosterToOwner = new Map(rosters.map((r) => [r.roster_id, r.owner_id]))
  const ownerToDisplayName = new Map(users.map((u) => [u.user_id, u.display_name]))

  const managerUserIds = tx.roster_ids.map((rosterId) => ({
    rosterId,
    sleeperUserId: rosterToOwner.get(rosterId) ?? null,
  }))
  const managerDisplayNames = managerUserIds.map(({ rosterId, sleeperUserId }) => ({
    rosterId,
    displayName: sleeperUserId ? ownerToDisplayName.get(sleeperUserId) ?? null : null,
  }))

  const isDynasty = league.settings?.type === 2 || league.settings?.type === 1
  const numQb = (league.roster_positions ?? []).filter((p) => p === 'QB' || p === 'SUPER_FLEX').length
  const isSuperFlex = numQb >= 2
  const rosterConfig = deriveLeagueRosterConfig(league.roster_positions ?? [], league.total_rosters, isSuperFlex)

  // Canonical "proposer" perspective for give/receive framing — the first
  // roster in the transaction's roster_ids array. Arbitrary but consistent,
  // matching how a real 2-sided trade is represented from one side's view.
  const proposerRosterId = tx.roster_ids[0]

  const given: ResolvedAsset[] = []
  const received: ResolvedAsset[] = []

  const adds = tx.adds ?? {}
  const drops = tx.drops ?? {}

  for (const [playerId, toRosterId] of Object.entries(adds)) {
    const asset = resolveDropOrAddAsset(playerId, players, fcPlayers, rosterConfig)
    if (toRosterId === proposerRosterId) received.push(asset)
    else given.push(asset)
  }
  for (const [playerId, fromRosterId] of Object.entries(drops)) {
    // A player appearing in `drops` for the proposer means the proposer gave
    // it up; guard against double-counting if it also appeared in `adds`
    // (shouldn't happen for the same player, but stay defensive).
    if (fromRosterId === proposerRosterId && !given.some((g) => g.name === resolveDropOrAddAsset(playerId, players, fcPlayers, rosterConfig).name)) {
      given.push(resolveDropOrAddAsset(playerId, players, fcPlayers, rosterConfig))
    }
  }

  for (const pick of tx.draft_picks ?? []) {
    const asset = resolvePickAsset(pick, isDynasty)
    if (pick.owner_id === proposerRosterId) received.push(asset)
    else if (pick.previous_owner_id === proposerRosterId) given.push(asset)
  }

  // Roster context (Phase 6): the counterparty is the other roster in the
  // transaction — a real 2-sided trade has exactly one, matching how
  // `computeTradeDrivers()`'s `rosterCtx.theirRoster` is already used
  // elsewhere in the codebase (a single counterparty roster, not N-way).
  const counterpartyRosterId = tx.roster_ids.find((id) => id !== proposerRosterId)
  const proposerRoster = resolveFullRoster(rosterById.get(proposerRosterId), players, fcPlayers, rosterConfig)
  const counterpartyRoster = counterpartyRosterId !== undefined
    ? resolveFullRoster(rosterById.get(counterpartyRosterId), players, fcPlayers, rosterConfig)
    : []

  const payload: TradeReplayPayload = {
    assetsGiven: given.map((a) => ({ name: a.name, value: a.value, type: a.type, pos: a.pos, vorpValue: a.vorpValue, providerAssetId: a.providerAssetId })),
    assetsReceived: received.map((a) => ({ name: a.name, value: a.value, type: a.type, pos: a.pos, vorpValue: a.vorpValue, providerAssetId: a.providerAssetId })),
    proposerRoster: proposerRoster.length > 0 ? proposerRoster : undefined,
    counterpartyRoster: counterpartyRoster.length > 0 ? counterpartyRoster : undefined,
  }

  const resolvedAt = tx.status === 'pending' ? null : new Date(tx.status_updated)

  return {
    provider: 'sleeper',
    decisionType: 'trade',
    providerLeagueId: league.league_id,
    providerTransactionId: tx.transaction_id,
    season: Number(league.season),
    providerWeek,
    proposedAt: new Date(tx.created),
    resolvedAt,
    providerStatus: tx.status,
    participantsInvolved: tx.roster_ids,
    managerUserIds,
    managerDisplayNames,
    payload,
    rawProviderPayload: tx as unknown,
    contextSnapshot: {
      scoring_settings: league.scoring_settings,
      roster_positions: league.roster_positions,
      settings: league.settings,
      total_rosters: league.total_rosters,
    },
    isDynasty,
    isSuperFlex,
    ingestSourceUserId,
  }
}
