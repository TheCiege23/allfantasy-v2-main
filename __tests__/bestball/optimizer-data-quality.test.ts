import { describe, expect, it } from 'vitest'
import { buildDataQuality } from '@/lib/bestball/optimizer'

describe('buildDataQuality', () => {
  it('reports AVAILABLE when every roster player has data', () => {
    const result = buildDataQuality(['a', 'b'], new Set(['a', 'b']))
    expect(result).toEqual({ status: 'AVAILABLE', excludedPlayerIds: [], warnings: [] })
  })

  it('reports UNAVAILABLE when no roster player has data', () => {
    const result = buildDataQuality(['a', 'b'], new Set())
    expect(result.status).toBe('UNAVAILABLE')
    expect(result.excludedPlayerIds).toEqual(['a', 'b'])
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it('reports PARTIAL and names the excluded players when some are missing', () => {
    const result = buildDataQuality(['a', 'b', 'c'], new Set(['a', 'c']))
    expect(result.status).toBe('PARTIAL')
    expect(result.excludedPlayerIds).toEqual(['b'])
  })

  it('treats an empty roster as vacuously AVAILABLE (callers gate on an empty roster upstream)', () => {
    const result = buildDataQuality([], new Set())
    expect(result).toEqual({ status: 'AVAILABLE', excludedPlayerIds: [], warnings: [] })
  })
})
