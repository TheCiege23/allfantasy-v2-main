/**
 * Validate a redraft trade proposal against the league's CURRENT rosters before anything is created.
 *
 * 🛑 WHY THIS EXISTS (audit #14). `POST /api/redraft/trade-proposals` — the path the Trade Center uses —
 * checked only that each asset's type was known and that it moved between the two rosters. It never checked
 * that the sending roster owned the player, had the FAAB, or wasn't offering the same player twice. A bad
 * offer was accepted, sat in the receiver's inbox, went through review or a league vote, and only failed at
 * settlement in `/api/redraft/trade-votes` — days later, after other managers had spent votes on it.
 *
 * The runtime create path (`createNflRedraftTradeProposal`) already validated through
 * `validateNflRedraftTradeProposal`: ownership, duplicates, the derived lineup lock, FAAB, roster limits, the
 * trade deadline and the league-wide move lock. This routes the Trade Center's path through the SAME
 * validator, so the two ways of proposing a trade can no longer disagree about what is legal.
 *
 * ⚠ THAT VALIDATOR WAS NFL-REDRAFT ONLY. `resolveNflRedraftTradeRuntime` refuses any other sport or format,
 * and those leagues — every dynasty league, NFL included, and every NBA / NHL / MLB league — fell to an
 * ownership-only check: no deadline, no lineup lock, no roster limit. They now run the SAME validator through
 * `resolveRedraftTradeRuntime`, the runtime with the NFL-redraft guard removed: the lineup lock is derived from
 * each sport's own schedule, the roster limit from each sport's roster config. NFL redraft is untouched — it
 * still takes the branch it always took, with the same inputs.
 *
 * The ownership-only check survives for the one case neither runtime can build: no season row or no league
 * rules to build it from.
 *
 * THE DEADLINE (lib/trade-deadline/tradeDeadlineWindow.ts) is measured against the server's week for every
 * branch. The league-wide runtime takes its verdict from there outright, so a dynasty offseason is never
 * refused by last season's deadline. The NFL redraft branch keeps its own check first, unchanged, and then
 * also answers to the server's week — which only differs for an imported season, whose stored week nothing
 * maintains.
 *
 * THE MOVE LOCK (`League.lockAllMoves`, lib/redraft/tradeMoveLock.ts). The NFL redraft runtime checks it
 * itself, first, and that branch is left alone so an NFL refusal stays exactly what it was. Every other branch
 * checks it here, before the deadline — the ownership fallback never looked at it.
 */
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { assertPirateTradeAllowed } from '@/lib/pirate/tradeGuard'
import {
  REDRAFT_DRAFT_PICK_REFUSAL,
  resolveNflRedraftTradeRuntime,
  resolveRedraftTradeRuntime,
  validateNflRedraftTradeProposal,
  type NflRedraftTradeAssetInput,
} from '@/lib/trade-runtime'
import { evaluateRedraftTradeDeadline, tradeDeadlinePassedMessage } from '@/lib/trade-deadline/tradeDeadlineWindow'
import {
  REDRAFT_MOVES_LOCKED_CODE,
  REDRAFT_MOVES_LOCKED_MESSAGE,
  isRedraftLeagueMovesLocked,
} from '@/lib/redraft/tradeMoveLock'

export type RedraftProposalValidationSource = 'nfl_runtime' | 'league_runtime' | 'ownership_fallback' | 'league_lock'

export type RedraftProposalValidation =
  | { ok: true; warnings: string[]; source: RedraftProposalValidationSource }
  | { ok: false; code: string; message: string; source: RedraftProposalValidationSource }

export type RedraftProposalValidationInput = {
  leagueId: string
  seasonId: string
  proposerRosterId: string
  receiverRosterId: string
  assets: NflRedraftTradeAssetInput[]
}

type ValidationDb = Pick<PrismaClient, 'redraftRosterPlayer' | 'redraftRoster' | 'league'>

async function pirateTradeRefusal(input: RedraftProposalValidationInput, source: RedraftProposalValidationSource): Promise<RedraftProposalValidation | null> {
  try {
    await assertPirateTradeAllowed(input.leagueId, input.assets.map((asset) => ({
      fromRosterId: asset.fromRosterId, assetType: asset.assetType, playerId: asset.playerId,
    })))
    return null
  } catch (error) {
    return { ok: false, code: 'PIRATE_TRADE_LOCK', message: error instanceof Error ? error.message : 'Pirate trade is locked.', source }
  }
}

export async function validateRedraftTradeProposalAtCreation(
  input: RedraftProposalValidationInput,
  db: ValidationDb = prisma,
): Promise<RedraftProposalValidation> {
  const runtime = await resolveNflRedraftTradeRuntime({ seasonId: input.seasonId, leagueId: input.leagueId })
  if (runtime.ok) {
    const result = validateNflRedraftTradeProposal({
      state: runtime.state,
      proposerRosterId: input.proposerRosterId,
      receiverRosterId: input.receiverRosterId,
      assets: input.assets,
    })
    if (!result.ok) return { ok: false, code: result.code, message: result.message, source: 'nfl_runtime' }
    const deadline = await evaluateRedraftTradeDeadline(input.leagueId)
    if (deadline.passed) {
      return { ok: false, code: 'TRADE_DEADLINE_PASSED', message: tradeDeadlinePassedMessage(deadline), source: 'nfl_runtime' }
    }
    const pirateRefusal = await pirateTradeRefusal(input, 'nfl_runtime')
    if (pirateRefusal) return pirateRefusal
    return { ok: true, warnings: result.warnings, source: 'nfl_runtime' }
  }

  // Ahead of the deadline, as the runtime orders them: under the lock nothing else about the trade matters.
  if (await isRedraftLeagueMovesLocked(input.leagueId, db)) {
    return { ok: false, code: REDRAFT_MOVES_LOCKED_CODE, message: REDRAFT_MOVES_LOCKED_MESSAGE, source: 'league_lock' }
  }

  // The server's week, read even when no deadline is set: the lineup lock is derived at it. An imported
  // season's stored week is one nothing maintains, and a lock read at a stale week locks every player
  // whose game that week has long since kicked off.
  const deadline = await evaluateRedraftTradeDeadline(input.leagueId, {}, { alwaysResolveWeek: true })
  const leagueRuntime = await resolveRedraftTradeRuntime({
    seasonId: input.seasonId,
    leagueId: input.leagueId,
    week: deadline.window?.inSeason ? deadline.window.week : null,
    inSeason: deadline.window ? deadline.window.inSeason : true,
  })
  if (leagueRuntime.ok) {
    const state = {
      ...leagueRuntime.state,
      // The deadline verdict is the server's, not `week > deadlineWeek` on whichever season row was read.
      settings: { ...leagueRuntime.state.settings, deadlinePassed: deadline.passed },
    }
    const result = validateNflRedraftTradeProposal({
      state,
      proposerRosterId: input.proposerRosterId,
      receiverRosterId: input.receiverRosterId,
      assets: input.assets,
    })
    if (!result.ok) return { ok: false, code: result.code, message: result.message, source: 'league_runtime' }
    const pirateRefusal = await pirateTradeRefusal(input, 'league_runtime')
    if (pirateRefusal) return pirateRefusal
    return { ok: true, warnings: result.warnings, source: 'league_runtime' }
  }

  if (deadline.passed) {
    return {
      ok: false,
      code: 'TRADE_DEADLINE_PASSED',
      message: tradeDeadlinePassedMessage(deadline),
      source: 'ownership_fallback',
    }
  }
  const ownership = await validateOwnershipFallback(db, input)
  if (!ownership.ok) return ownership
  return (await pirateTradeRefusal(input, 'ownership_fallback')) ?? ownership
}

function faabAmountOf(asset: NflRedraftTradeAssetInput): number {
  const metadata = asset.metadata && typeof asset.metadata === 'object' ? asset.metadata : {}
  const raw = asset.faabAmount ?? metadata.amount ?? metadata.faab ?? metadata.faabAmount ?? 0
  const n = Number(raw)
  return Number.isFinite(n) ? Math.floor(n) : 0
}

async function validateOwnershipFallback(
  db: ValidationDb,
  input: RedraftProposalValidationInput,
): Promise<RedraftProposalValidation> {
  const fail = (code: string, message: string): RedraftProposalValidation => ({
    ok: false,
    code,
    message,
    source: 'ownership_fallback',
  })

  const playerAssets: Array<{ playerId: string; playerName: string | null; fromRosterId: string }> = []
  const seenPlayers = new Set<string>()
  const faabDelta = new Map<string, number>()

  for (const asset of input.assets) {
    if (asset.assetType === 'player') {
      const playerId = asset.playerId?.trim()
      if (!playerId) return fail('INVALID_ASSET', 'Player trade assets require playerId.')
      if (seenPlayers.has(playerId)) return fail('DUPLICATE_ASSET', 'Trade includes the same asset more than once.')
      seenPlayers.add(playerId)
      playerAssets.push({ playerId, playerName: asset.playerName?.trim() || null, fromRosterId: asset.fromRosterId })
    } else if (asset.assetType === 'faab') {
      const amount = faabAmountOf(asset)
      if (amount <= 0) return fail('INVALID_ASSET', 'FAAB trade assets require a positive whole amount.')
      faabDelta.set(asset.fromRosterId, (faabDelta.get(asset.fromRosterId) ?? 0) - amount)
      faabDelta.set(asset.toRosterId, (faabDelta.get(asset.toRosterId) ?? 0) + amount)
    } else if (asset.assetType === 'draft_pick') {
      // No pick inventory on this path either, so a pick would change hands on paper only. This is
      // the path a NATIVE DYNASTY league reaches — the NFL runtime refuses dynasty — and those leagues
      // now trade real picks in the Trade Center (lib/league-trade-engine/nativeFuturePicks.ts).
      return fail('DRAFT_PICK_NOT_SETTLED', REDRAFT_DRAFT_PICK_REFUSAL)
    }
  }

  if (playerAssets.length > 0) {
    const rows = await db.redraftRosterPlayer.findMany({
      where: {
        rosterId: { in: [input.proposerRosterId, input.receiverRosterId] },
        playerId: { in: playerAssets.map((asset) => asset.playerId) },
        droppedAt: null,
      },
      select: { rosterId: true, playerId: true },
    })
    const ownerOf = new Map(rows.map((row) => [row.playerId, row.rosterId]))
    for (const asset of playerAssets) {
      if (ownerOf.get(asset.playerId) !== asset.fromRosterId) {
        return fail('PLAYER_NOT_OWNED', `${asset.playerName ?? asset.playerId} is not active on the sending roster.`)
      }
    }
  }

  const spenders = [...faabDelta.entries()].filter(([, delta]) => delta < 0)
  if (spenders.length > 0) {
    const rosters = await db.redraftRoster.findMany({
      where: { id: { in: spenders.map(([rosterId]) => rosterId) } },
      select: { id: true, faabBalance: true },
    })
    const balanceOf = new Map(rosters.map((roster) => [roster.id, roster.faabBalance ?? 0]))
    for (const [rosterId, delta] of spenders) {
      if ((balanceOf.get(rosterId) ?? 0) + delta < 0) {
        return fail('INSUFFICIENT_FAAB', 'The sending roster does not have enough FAAB for this trade.')
      }
    }
  }

  return { ok: true, warnings: [], source: 'ownership_fallback' }
}
