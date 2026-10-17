/**
 * Where a game is in its day: live, not started, or over.
 *
 * The live slate is grouped by this before anything else (see Build rule 2 in
 * `liveScoresPage.ts`). Pure and client-safe, so the server sort and the
 * screen's held order use the same rule.
 */
export type GameStage = 'live' | 'upcoming' | 'final'

type StageInput = { isLive: boolean; completed: boolean }

export function gameStage(game: StageInput): GameStage {
  if (game.isLive) return 'live'
  return game.completed ? 'final' : 'upcoming'
}

const RANK: Record<GameStage, number> = { live: 0, upcoming: 1, final: 2 }

/** Live first, then not started, then final. */
export function gameStageRank(game: StageInput): number {
  return RANK[gameStage(game)]
}

/**
 * Regroup a list by stage, keeping each stage's existing order.
 *
 * ⚠ ONLY THE STAGE MOVES A CARD. The screen holds the order you are reading
 * (`applyStableOrder`), so a game does not jump because its win probability
 * ticked. It does move when it kicks off or ends — a change you can see on the
 * card itself, and the one that decides whether it still matters to you.
 * `Array.prototype.sort` is stable, which is what keeps the order inside a stage.
 */
export function groupByStage<T extends StageInput>(games: readonly T[]): T[] {
  return [...games].sort((a, b) => gameStageRank(a) - gameStageRank(b))
}
