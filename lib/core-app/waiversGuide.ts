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
