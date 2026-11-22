/**
 * RookieRanking gained a `sport` column. Every reader is an NFL surface, so each must ask for NFL rows
 * only — otherwise the first MLB/NBA/NHL ranking written would appear in NFL ADP, mock boards and
 * trade intel. Asserted on each reader's query source and on the schema.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

describe('RookieRanking readers are scoped to NFL', () => {
  it('the schema declares sport and keys uniqueness on it', () => {
    const schema = readFileSync('prisma/schema.prisma', 'utf8')
    const model = schema.slice(schema.indexOf('model RookieRanking {'), schema.indexOf('model MockDraft {'))
    expect(model).toMatch(/sport\s+String\s+@default\("NFL"\)/)
    expect(model).toMatch(/@@unique\(\[sport, year, name\]\)/)
  })

  it('every reader filters on sport: NFL', () => {
    for (const file of ['lib/adp-data.ts', 'lib/mock-draft/adp-realtime-adjuster.ts', 'lib/trade-engine/trade-analyzer-intel.ts']) {
      const src = readFileSync(file, 'utf8')
      const i = src.indexOf('rookieRanking.findMany(')
      expect(i, file).toBeGreaterThan(-1)
      expect(src.slice(i, i + 400), file).toMatch(/where:\s*\{\s*sport:\s*'NFL'/)
    }
  })

})
