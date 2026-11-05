import { describe, it, expect } from 'vitest'
import { READ_OPTIMIZATIONS, readOptimizationEnabled } from '@/lib/perf/readOptimizations'

describe('AF_READ_OPTIMIZATIONS_OFF', () => {
  const cases: Array<[string | undefined, string[]]> = [
    [undefined, []],
    ['', []],
    ['value-combos', ['value-combos']],
    ['draft-facts', ['draft-facts']],
    ['injury-alerts', ['injury-alerts']],
    ['VALUE-COMBOS, injury-alerts', ['value-combos', 'injury-alerts']],
    ['value-combos draft-facts injury-alerts', ['value-combos', 'draft-facts', 'injury-alerts']],
    ['all', [...READ_OPTIMIZATIONS]],
    ['not-a-path', []],
  ]
  it.each(cases)('%j turns off exactly %j', (value, off) => {
    const env = { AF_READ_OPTIMIZATIONS_OFF: value }
    for (const name of READ_OPTIMIZATIONS) {
      expect(readOptimizationEnabled(name, env)).toBe(!off.includes(name))
    }
  })
})
