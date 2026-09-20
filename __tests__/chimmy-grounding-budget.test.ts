import { describe, expect, it } from 'vitest'
import { applyGroundingBudget, DEFAULT_GROUNDING_BUDGET } from '@/lib/chimmy/groundingBudget'

const SEP = '\n\n'

function block(label: string, size: number) {
  return `${label}: ${'x'.repeat(Math.max(0, size - label.length - 2))}`
}

describe('applyGroundingBudget', () => {
  it('leaves a prompt that already fits completely alone', () => {
    const text = [block('A', 100), block('B', 100)].join(SEP)
    const out = applyGroundingBudget(text, DEFAULT_GROUNDING_BUDGET)

    expect(out.text).toBe(text)
    expect(out.droppedBlocks).toBe(0)
    expect(out.keptBlocks).toBe(2)
  })

  /*
   * The core property. Every block ends with its own constraint line, so a cut
   * landing mid-block would keep the data and lose the rule — which is how a
   * grounded answer becomes a confident wrong one.
   */
  it('drops whole blocks rather than cutting one in half', () => {
    const a = block('KEEP', 100)
    const b = `TRADES: values are not stored${SEP.trim()}RULES: do not grade these trades`
    const text = [a, b].join(SEP)

    const out = applyGroundingBudget(text, 150)

    expect(out.text).toContain('KEEP')
    // The second block is absent entirely — not partially present.
    expect(out.text).not.toContain('values are not stored')
    expect(out.droppedBlocks).toBeGreaterThan(0)
  })

  it('says what it dropped instead of shortening silently', () => {
    const text = [block('A', 100), block('B', 100), block('C', 100)].join(SEP)
    const out = applyGroundingBudget(text, 150)

    expect(out.text).toContain('GROUNDING TRUNCATED')
    expect(out.text).toMatch(/Do not answer as though you had the full picture/i)
  })

  it('keeps the earliest blocks, which are the most decision-relevant', () => {
    const text = [block('FIRST', 100), block('SECOND', 100), block('THIRD', 100)].join(SEP)
    const out = applyGroundingBudget(text, 250)

    expect(out.text).toContain('FIRST')
    expect(out.text).not.toContain('THIRD')
  })

  it('never exceeds the budget by more than its own notice', () => {
    const text = Array.from({ length: 20 }, (_, i) => block(`B${i}`, 500)).join(SEP)
    const budget = 1200
    const out = applyGroundingBudget(text, budget)

    const withoutNotice = out.text.split('[GROUNDING TRUNCATED')[0]
    expect(withoutNotice.length).toBeLessThanOrEqual(budget)
  })

  /*
   * A single oversized block would otherwise keep nothing and say only that
   * everything was dropped, losing even the name of the source.
   */
  it('keeps a labelled head when one block exceeds the whole budget', () => {
    const out = applyGroundingBudget(`STANDINGS: ${'x'.repeat(5000)}`, 600)

    expect(out.text).toContain('STANDINGS')
    expect(out.text).toContain('TRUNCATED')
    expect(out.text).toMatch(/Treat it as incomplete/i)
  })

  it('handles an empty context', () => {
    const out = applyGroundingBudget('', 100)
    expect(out.text).toBe('')
    expect(out.keptBlocks).toBe(0)
    expect(out.droppedBlocks).toBe(0)
  })

  it('reports the original size so truncation is measurable', () => {
    const text = Array.from({ length: 10 }, (_, i) => block(`B${i}`, 500)).join(SEP)
    const out = applyGroundingBudget(text, 900)
    expect(out.originalLength).toBe(text.length)
  })

  /*
   * 🛑 A COUNT CANNOT TELL YOU WHAT THE MODEL LOST. "dropped 3 of 21" is true and
   * unactionable — ~20 sources append here and drops come from the END, so the
   * count cannot distinguish the live slate going from the trade history going.
   * That is the gap that left a real incident unexplainable on 2026-09-20.
   */
  describe('droppedLabels', () => {
    it('names the blocks it dropped, in order', () => {
      const text = [
        `ROSTER\n${'x'.repeat(200)}`,
        `STANDINGS\n${'x'.repeat(200)}`,
        `COMPLETED TRADE HISTORY for this league (Sleeper league 123)\n${'x'.repeat(200)}`,
      ].join(SEP)

      const out = applyGroundingBudget(text, 250)

      expect(out.droppedLabels).toEqual([
        'STANDINGS',
        'COMPLETED TRADE HISTORY for this league',
      ])
    })

    /*
     * The parenthetical is cut so the label is stable across leagues and carries
     * no ids into a log line.
     */
    it('strips the parenthetical so the label is an id-free heading', () => {
      const text = [
        `KEEP\n${'x'.repeat(200)}`,
        `COMPLETED TRADE HISTORY for this league (Sleeper league 1338541390891606016)\n${'x'.repeat(200)}`,
      ].join(SEP)

      const out = applyGroundingBudget(text, 210)

      expect(out.droppedLabels).toEqual(['COMPLETED TRADE HISTORY for this league'])
      expect(out.droppedLabels.join()).not.toContain('1338541390891606016')
    })

    it('is empty when nothing was dropped', () => {
      const text = [block('A', 100), block('B', 100)].join(SEP)
      expect(applyGroundingBudget(text, DEFAULT_GROUNDING_BUDGET).droppedLabels).toEqual([])
      expect(applyGroundingBudget('', 100).droppedLabels).toEqual([])
    })

    /*
     * The invariant that makes the log line trustworthy: if these two ever
     * disagree, the labels are describing a different set of blocks than the
     * count, and reading either one misleads.
     */
    it('always has exactly droppedBlocks entries, including the oversized-block path', () => {
      const many = Array.from({ length: 12 }, (_, i) => `H${i}\n${'x'.repeat(400)}`).join(SEP)
      const truncated = applyGroundingBudget(many, 1000)
      expect(truncated.droppedLabels).toHaveLength(truncated.droppedBlocks)

      const oversized = applyGroundingBudget(`STANDINGS\n${'x'.repeat(5000)}`, 600)
      expect(oversized.droppedLabels).toHaveLength(oversized.droppedBlocks)
      expect(oversized.droppedLabels).toEqual(['STANDINGS'])
    })

    it('caps a long heading so one block cannot flood the log line', () => {
      const long = 'H'.repeat(300)
      const text = [`KEEP\n${'x'.repeat(200)}`, `${long}\n${'x'.repeat(200)}`].join(SEP)

      const out = applyGroundingBudget(text, 210)

      expect(out.droppedLabels).toHaveLength(1)
      expect(out.droppedLabels[0].length).toBeLessThanOrEqual(80)
      expect(out.droppedLabels[0].endsWith('...')).toBe(true)
    })

    it('labels a block with no heading rather than emitting an empty string', () => {
      const text = [`KEEP\n${'x'.repeat(200)}`, `\n${'x'.repeat(200)}`].join(SEP)
      const out = applyGroundingBudget(text, 210)
      expect(out.droppedLabels).toEqual(['(unlabelled block)'])
    })
  })
})
