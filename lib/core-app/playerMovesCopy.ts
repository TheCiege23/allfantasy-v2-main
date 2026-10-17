import { coreUiCopy } from './coreUiCopy'
import type { MoveScreen, PlayerMove } from './playerMoves'

/**
 * Player Finder's recommended moves in Spanish (2026-10-04).
 *
 * `composePlayerMoves` writes each move's title, path and note in English — its output is pinned by
 * __tests__/player-finder-moves.test.ts — and carries `parts`, the values those sentences were built
 * from. This rebuilds them in the reader's language at render, the way decisionQueueCopy.ts does for
 * the home's decision queue.
 *
 * ⚠ NO SENTENCE IS TRANSLATED BY PATTERN. The lock reason is the one exception, and it is not a
 * sentence this module writes: it is swapLegality's English (`locked — Ferguson’s game kicked off Sun
 * 1:00p ET`), and it goes through `coreUiCopy`'s lock patterns like every other lock label in /core,
 * its clock through `kickoffText`. An injury designation goes through `coreUiCopy`'s table.
 *
 * A move without `parts` returns its English as written — a whole English card, never half of one.
 * PURE, client-safe.
 */

export type MoveText = { title: string; path: string; note: string | null }

const SCREEN_ES: Record<MoveScreen, string> = {
  Roster: 'Plantilla',
  Lineup: 'Alineación',
  Waivers: coreUiCopy('Waivers', 'es'),
}

/**
 * The lineup slot a player sits in (playerImpact.ts `slot`, playerFinder.ts `LeagueSlot.slot`); a
 * position ("TE", "SUPER_FLEX") and TAXI stay — the help topics keep TAXI too. NOT YOURS is the
 * finder table's chip on a league where another manager has him (2026-10-04).
 */
const SLOT_ES: Record<string, string> = { STARTER: 'TITULAR', BENCH: 'BANCA', 'IR SLOT': 'PUESTO IR', 'NOT YOURS': 'NO ES TUYO' }

export function slotText(slot: string, language: string): string {
  return language === 'es' ? (SLOT_ES[slot] ?? slot) : slot
}

/** The move in the reader's language: Spanish rebuilt from its parts, or its English as written. */
export function moveText(move: PlayerMove, language: string): MoveText {
  const english: MoveText = { title: move.title, path: move.path, note: move.note }
  const p = move.parts
  if (language !== 'es' || !p) return english

  const path = [p.path.platform, p.path.league ?? 'Liga', SCREEN_ES[p.path.screen]].join(' › ')
  const lock = move.locked ? coreUiCopy(move.locked, 'es') : null
  const note = (...rest: Array<string | null>) => [lock, ...rest].filter(Boolean).join(' · ') || null

  switch (p.kind) {
    case 'ir':
      return {
        title: `Saca a ${p.last} del IR: está ${p.status ? coreUiCopy(p.status, 'es').toLowerCase() : 'activo'}`,
        path,
        note: note('un jugador en el puesto de IR no anota puntos'),
      }
    case 'swap':
      return {
        title: `Sienta a ${p.outLast} y alinea a ${p.last}${p.slot ? ` en ${p.slot}` : ''}`,
        path,
        note: note(p.slotUnconfirmed ? 'puesto sin confirmar: válido en algún lugar de esta alineación' : null),
      }
    case 'claim':
      return {
        title: `Reclama a ${p.name} en lugar de ${p.last}`,
        path,
        note: note(p.position, 'sin equipo', p.week != null ? `semana ${p.week}` : null, 'puntuación estándar'),
      }
    default:
      return english
  }
}
