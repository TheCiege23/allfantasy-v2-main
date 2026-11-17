/**
 * The headline of a league's Waivers page in plain words (2026-11-13). The owner's ask: users should
 * know what the page is for. The answer people open it for is "who should I pick up", and the
 * "Worth adding" board already ranks that (lib/waivers/waiverBoard.ts) — this only reads its top row.
 *
 * Pure, so the rule is testable and the screen stays a renderer.
 */
import type { WaiverBoard } from '@/lib/waivers/waiverBoard'
import { isPerGameBasis } from '@/lib/waivers/waiverSportBasis'

export type WaiverPick =
  /** The board is still loading, or could not load (the board removes itself on failure). */
  | { kind: 'pending' }
  /** The board cannot rank this league (no claimed team, no scoring, …) — the board says why. */
  | { kind: 'unranked' }
  /** It ranked the wire and nobody improves your starting lineup. */
  | { kind: 'none'; perGame: boolean }
  /** The best add: who, how much he adds, and whom he replaces (null when he fills an empty slot). */
  | { kind: 'best'; name: string; gain: number; replaces: string | null; perGame: boolean; count: number }

export function waiverPick(board: Pick<WaiverBoard, 'state' | 'candidates' | 'basis'> | null | undefined): WaiverPick {
  if (!board) return { kind: 'pending' }
  if (board.state !== 'ok') return { kind: 'unranked' }
  const perGame = isPerGameBasis(board.basis)
  const top = board.candidates[0]
  if (!top) return { kind: 'none', perGame }
  return {
    kind: 'best',
    name: top.name,
    gain: top.gain,
    replaces: top.displaces?.name ?? null,
    perGame,
    count: board.candidates.length,
  }
}

/* ── 2026-11-14: one line per manager in Competitive Edge ────────────────────────────────────── */

/**
 * The facts a manager card said in four sentences ("TheBigSisterFister has $1,001 of FAAB left — more
 * than your $449. TheBigSisterFister has won 8 waiver claims this season, spending $0 in all. 8 of their
 * 8 claims were $0 bids. 3 of their 8 claims were RBs."), as the pieces of one line:
 * "$1,001 left · 8 claims, all at $0 · 3 RBs". The name is the card's heading, and "more than your
 * $449" is said once, by the league line above the cards. Read off each fact's `parts`; a fact without
 * them is skipped rather than guessed from its English.
 */
export type RivalPiece =
  | { kind: 'left'; amount: number }
  | { kind: 'noClaims' }
  | { kind: 'claims'; claims: number; zero: number; spent: number | null }
  | { kind: 'biggest'; bid: number; position: string | null }
  | { kind: 'position'; position: string; count: number }

type RivalFactParts =
  | { kind: 'faab_left'; left: number }
  | { kind: 'no_claims' }
  | { kind: 'claims'; claims: number; spent: number | null }
  | { kind: 'biggest_bid'; bid: number; position: string | null }
  | { kind: 'zero_bids'; zero: number; claims: number }
  | { kind: 'position'; position: string; count: number }
  | { kind: string }

export function rivalPieces(facts: Array<{ parts?: RivalFactParts | null }>): RivalPiece[] {
  const out: RivalPiece[] = []
  let claims: Extract<RivalPiece, { kind: 'claims' }> | null = null
  let zero = 0
  for (const f of facts) {
    const p = f.parts as RivalFactParts | undefined
    if (!p) continue
    if (p.kind === 'faab_left' && 'left' in p) out.push({ kind: 'left', amount: p.left })
    else if (p.kind === 'no_claims') out.push({ kind: 'noClaims' })
    else if (p.kind === 'claims' && 'claims' in p) {
      claims = { kind: 'claims', claims: p.claims, zero: 0, spent: 'spent' in p ? p.spent : null }
      out.push(claims)
    } else if (p.kind === 'zero_bids' && 'zero' in p) zero = p.zero
    else if (p.kind === 'biggest_bid' && 'bid' in p) out.push({ kind: 'biggest', bid: p.bid, position: p.position })
    else if (p.kind === 'position' && 'count' in p) out.push({ kind: 'position', position: p.position, count: p.count })
  }
  if (claims) claims.zero = zero
  return out
}
