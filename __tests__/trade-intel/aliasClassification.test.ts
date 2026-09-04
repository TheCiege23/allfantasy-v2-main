/**
 * `aliasTags` carries two different kinds of thing, and `readFormatRules` must only let one of them
 * override `leagueType`.
 *
 * 🛑 WHAT THIS FILE EXISTS TO STOP HAPPENING. Against the shapes actually stored in production on
 * 2026-09-03 — 183 of 271 leagues (68%) carry `aliasTags: ['idp']` — `readFormatRules` took
 * `alias[0]` unconditionally, and `idp` maps to redraft in the concept chain:
 *
 *     dynasty    + ['idp']    97 leagues  →  redraft
 *     guillotine + ['idp']    11 leagues  →  redraft
 *     zombie     + ['idp']     2 leagues  →  redraft
 *
 * 110 of 271 — 41% — to the wrong format, the 97 dynasty leagues being the expensive ones.
 *
 * ⚠ IT WAS LATENT. No production caller passes `aliasTags`, so the function had only ever seen
 * `undefined` and nothing was misresolved in the field. It would have fired on the next correct
 * change: the module's header instructs readers to pass the tags through, so obeying that
 * instruction misroutes 110 leagues in the same commit that fixes four. Every test was green
 * throughout, because no test had ever paired a real `leagueType` with a real modifier tag — the
 * combination is only reachable from data, which is where it was found.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FORMAT_ALIASES, MODIFIER_ALIASES, readFormatRules } from '@/lib/trade-intel/leagueFormatRules'

const ROOT = process.cwd()

/**
 * Every tag any producer is CAPABLE of pushing, read out of the source.
 *
 * ⚠ SOURCE-SCANNED RATHER THAN DRIVEN THROUGH THE FUNCTIONS, DELIBERATELY. A test that feeds
 * `normalizeConceptToFormat` a list of concept ids only discovers tags for the ids the list happens
 * to contain — so a new tag added beside a new concept would be invisible to it, which is the exact
 * blind spot that let `idp` through. Reading the pushes finds a tag the moment it is written, with
 * no test input required.
 */
function producibleAliasTags(): string[] {
  const files = [
    'lib/league-creation/canonical/normalizeConcept.ts',
    'lib/league-import/canonicalImportNormalizer.ts',
  ]
  const found = new Set<string>()
  for (const f of files) {
    const src = readFileSync(join(ROOT, f), 'utf8')
    for (const m of src.matchAll(/alias[A-Za-z]*\.push\(\s*'([^']+)'\s*\)/g)) found.add(m[1])
  }
  return [...found].sort()
}

describe('🛑 every producible alias tag is classified', () => {
  it('finds the tags at all — the scan is not silently matching nothing', () => {
    /*
     * The positive control for the control. A regex that stops matching (a producer renamed, a
     * file moved) would report an empty set, and an empty set passes the classification test below
     * vacuously — a check that cannot fail, which is the shape this repo has been bitten by
     * repeatedly. Pinning the four known tags means the scan must keep working to stay green.
     */
    expect(producibleAliasTags()).toEqual(['idp', 'king_of_the_hill', 'pirate_vampire', 'royal'])
  })

  it('classifies each as exactly one of format-alias or modifier', () => {
    for (const tag of producibleAliasTags()) {
      const isFormat = FORMAT_ALIASES.has(tag)
      const isModifier = MODIFIER_ALIASES.has(tag)
      expect(
        isFormat !== isModifier,
        `alias tag '${tag}' is ${isFormat && isModifier ? 'in BOTH sets' : 'in NEITHER set'}. ` +
          `Decide whether it names a FORMAT (may override leagueType) or is a SCORING/ROSTER ` +
          `MODIFIER (must not), and add it to the matching set in lib/trade-intel/leagueFormatRules.ts.`,
      ).toBe(true)
    }
  })
})

describe('🛑 the real production shapes, measured 2026-09-03', () => {
  const concept = (leagueType: string, aliasTags: string[]) =>
    readFormatRules({ leagueType, aliasTags }).concept

  it('a modifier tag does NOT override the format — the 110-league bug', () => {
    expect(concept('dynasty', ['idp'])).toBe('dynasty')
    expect(concept('guillotine', ['idp'])).toBe('guillotine')
    expect(concept('zombie', ['idp'])).toBe('zombie')
  })

  it('the shapes that were already correct stay correct', () => {
    expect(concept('guillotine', [])).toBe('guillotine')
    expect(concept('survivor', [])).toBe('survivor')
    expect(concept('redraft', ['idp'])).toBe('redraft')
    expect(concept('redraft', [])).toBe('redraft')
  })

  it('a FORMAT alias still wins, which is the behaviour the field was added for', () => {
    // `normalizeConcept` flattens these onto a base shell and keeps the truth only in the alias.
    expect(concept('dynasty', ['pirate_vampire'])).toBe('pirate')
    expect(concept('redraft', ['king_of_the_hill'])).toBe('king_of_the_hill')
    // `royal` is a dynasty flavour: the alias resolves, and it resolves TO dynasty.
    expect(concept('dynasty', ['royal'])).toBe('dynasty')
  })

  it('🛑 position in the array carries no meaning', () => {
    /*
     * The import path builds the list as `[...normaliserTags, ...idpTags]`, so a pirate league with
     * IDP scoring gets `['pirate_vampire', 'idp']` while a plain IDP dynasty gets `['idp']`. Under
     * `alias[0]` the first league worked and the second did not, for no reason a reader could see.
     * Both orders must now give the same answer.
     */
    expect(concept('dynasty', ['pirate_vampire', 'idp'])).toBe('pirate')
    expect(concept('dynasty', ['idp', 'pirate_vampire'])).toBe('pirate')
  })

  it('an unrecognised alias degrades to leagueType rather than to nothing', () => {
    // The honest degrade: leagueType is the canonical id, never wrong — only less specific.
    expect(concept('dynasty', ['some_future_scoring_flag'])).toBe('dynasty')
    expect(concept('guillotine', ['superflex', 'idp'])).toBe('guillotine')
  })
})
