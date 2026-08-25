/**
 * A CHARACTER BUDGET FOR THE GROUNDING PROMPT, ENFORCED BY DROPPING WHOLE
 * BLOCKS.
 *
 * ⚠ THE CONTEXT WAS UNBOUNDED, AND IT GREW. `legacyEnrichmentContext` is built
 * by appending one block per source — roster, standings, draft, waivers, trade
 * history, described trades, player news, commissioner view, live slate — and
 * nothing capped the total. The memory section next to it is capped at 4,000
 * characters; this was not capped at all.
 *
 * ⚠ TRUNCATING MID-BLOCK IS THE WORST AVAILABLE OUTCOME, which is why this
 * drops whole blocks instead. Every block ends with its own constraint line —
 * "no trade values are stored, do not grade them", "do NOT say a projection
 * dropped because of this", "only a NOT STARTED player can still be benched".
 * A cut that lands mid-block keeps the data and loses the rule, which is
 * precisely how a grounded answer becomes a confident wrong one. Half a block is
 * worse than no block.
 *
 * ⚠ WHAT WAS DROPPED IS STATED, NOT HIDDEN. A silently shortened prompt looks
 * identical to a complete one, so the model is told what it is missing and
 * instructed not to answer as though it had it.
 */

/** Blocks are joined by a blank line, which is what makes them separable here. */
const BLOCK_SEPARATOR = '\n\n'

/**
 * Roughly 30k characters. Deliberately generous — the point is to stop an
 * unbounded prompt, not to trim a healthy one — and expressed in characters
 * rather than tokens because the exact tokenizer varies by provider and a
 * character cap cannot drift out of step with one.
 */
export const DEFAULT_GROUNDING_BUDGET = 30_000

export type GroundingBudgetResult = {
  text: string
  keptBlocks: number
  droppedBlocks: number
  originalLength: number
}

/**
 * Trim grounding to fit a budget, dropping trailing blocks whole.
 *
 * Order is preserved and drops come from the END, because the route appends in
 * rough order of how directly a block bears on a decision — the viewer's own
 * roster and league before league-wide colour.
 */
export function applyGroundingBudget(
  context: string,
  budget: number = DEFAULT_GROUNDING_BUDGET,
): GroundingBudgetResult {
  const original = context ?? ''
  if (original.length <= budget) {
    return {
      text: original,
      keptBlocks: original.trim() ? original.split(BLOCK_SEPARATOR).length : 0,
      droppedBlocks: 0,
      originalLength: original.length,
    }
  }

  const blocks = original.split(BLOCK_SEPARATOR)
  const kept: string[] = []
  let used = 0

  for (const block of blocks) {
    const cost = block.length + (kept.length > 0 ? BLOCK_SEPARATOR.length : 0)
    if (used + cost > budget) break
    kept.push(block)
    used += cost
  }

  const dropped = blocks.length - kept.length

  /*
   * A single block larger than the whole budget would otherwise keep nothing and
   * say only that everything was dropped. Keep its opening — enough to name what
   * the source was — and mark it plainly as incomplete so nothing in it reads as
   * a full picture.
   */
  if (kept.length === 0 && blocks.length > 0) {
    const head = blocks[0].slice(0, Math.max(0, budget - 200))
    return {
      text: `${head}\n[TRUNCATED — this block was too large to include in full. Treat it as incomplete and do not draw conclusions from what is missing.]`,
      keptBlocks: 0,
      droppedBlocks: blocks.length,
      originalLength: original.length,
    }
  }

  const notice = `[GROUNDING TRUNCATED: ${dropped} context block${dropped === 1 ? '' : 's'} did not fit and ${dropped === 1 ? 'was' : 'were'} left out. You are missing information you would normally have. Do not answer as though you had the full picture — say what you could not see if it bears on the question.]`

  return {
    text: `${kept.join(BLOCK_SEPARATOR)}${BLOCK_SEPARATOR}${notice}`,
    keptBlocks: kept.length,
    droppedBlocks: dropped,
    originalLength: original.length,
  }
}
