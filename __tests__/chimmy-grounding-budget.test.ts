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
})
