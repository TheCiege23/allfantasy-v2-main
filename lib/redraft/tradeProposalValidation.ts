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
 * ⚠ THAT VALIDATOR IS NFL-REDRAFT ONLY. `resolveNflRedraftTradeRuntime` refuses any other sport or format
 * (production on 2026-09-13: 247 NFL redraft seasons, 1 NCAAF). Rather than leave those unvalidated, they get
 * the sport-agnostic core — ownership, duplicate players, and FAAB — read straight from the roster tables.
 * No lock or roster-limit check exists for them, because no lock source exists for them.
 */
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  resolveNflRedraftTradeRuntime,
  validateNflRedraftTradeProposal,
  type NflRedraftTradeAssetInput,
} from '@/lib/trade-runtime'

export type RedraftProposalValidationSource = 'nfl_runtime' | 'ownership_fallback'

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

type ValidationDb = Pick<PrismaClient, 'redraftRosterPlayer' | 'redraftRoster'>

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
    return result.ok
      ? { ok: true, warnings: result.warnings, source: 'nfl_runtime' }
      : { ok: false, code: result.code, message: result.message, source: 'nfl_runtime' }
  }
  return validateOwnershipFallback(db, input)
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
