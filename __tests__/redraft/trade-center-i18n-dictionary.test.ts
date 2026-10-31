/**
 * The native redraft Trade Center's dictionary: every `tradeCenter.*` key the two components use exists
 * in English and Spanish, and the Spanish is actually Spanish (differs from the English, no «waiver»).
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { translations } from '@/lib/i18n/translations'

const FILES = [
  'app/league/[leagueId]/tabs/redraft/TradeCenter.tsx',
  'app/league/[leagueId]/tabs/redraft/TradeCenterModal.tsx',
]
const src = FILES.map((f) => fs.readFileSync(path.join(process.cwd(), f), 'utf8')).join('\n')

const en = translations.en
const es = translations.es
const enKeys = Object.keys(en).filter((k) => k.startsWith('tradeCenter.'))

/** Keys the components build at runtime from a fixed set of values. */
const DYNAMIC: Record<string, string[]> = {
  'tradeCenter.action.': ['accept', 'reject', 'cancel', 'vote_approve', 'vote_veto'],
  'tradeCenter.error.action.': ['accept', 'reject', 'cancel', 'vote_approve', 'vote_veto', 'commissioner_approve', 'commissioner_veto'],
  'tradeCenter.status.': ['pending', 'accepted', 'rejected', 'cancelled', 'vetoed', 'expired'],
  'tradeCenter.reviewType.': ['commissioner', 'league_vote', 'instant', 'no_veto'],
  'tradeCenter.pickStatus.': ['supported', 'disabled'],
}

function referencedKeys(): string[] {
  const out = new Set<string>()
  for (const m of src.matchAll(/'(tradeCenter\.[a-zA-Z0-9_.]+)'/g)) out.add(m[1]!)
  // plural('tradeCenter.x', n) resolves to x.one / x.many.
  for (const m of src.matchAll(/plural\('(tradeCenter\.[a-zA-Z0-9_.]+)'/g)) {
    out.delete(m[1]!)
    out.add(`${m[1]}.one`)
    out.add(`${m[1]}.many`)
  }
  for (const [prefix, values] of Object.entries(DYNAMIC)) for (const v of values) out.add(prefix + v)
  // `labelFor(t, 'tradeCenter.status', …)` passes a prefix, covered by DYNAMIC above.
  return [...out].filter((k) => !k.endsWith('.') && !(`${k}.` in DYNAMIC))
}

describe('tradeCenter.* dictionary', () => {
  it('has a real set of keys', () => {
    expect(enKeys.length).toBeGreaterThan(100)
  })

  it('every key the components reference exists in English and in Spanish', () => {
    const keys = referencedKeys()
    expect(keys.length).toBeGreaterThan(80)
    expect(keys.filter((k) => !(k in en))).toEqual([])
    expect(keys.filter((k) => !(k in es))).toEqual([])
  })

  it('every English key has Spanish, and the Spanish differs from the English', () => {
    expect(enKeys.filter((k) => !(k in es))).toEqual([])
    expect(enKeys.filter((k) => es[k] === en[k])).toEqual([])
    // A Spanish-only key would be dead copy.
    expect(Object.keys(es).filter((k) => k.startsWith('tradeCenter.') && !(k in en))).toEqual([])
  })

  it('the Spanish never says «waiver», and keeps FAAB as FAAB', () => {
    expect(enKeys.filter((k) => /waiver/i.test(es[k] ?? ''))).toEqual([])
    for (const k of enKeys) if (en[k]!.includes('FAAB')) expect(es[k], k).toContain('FAAB')
  })

  it('plural keys come in pairs', () => {
    const plurals = enKeys.filter((k) => /\.(one|many)$/.test(k)).map((k) => k.replace(/\.(one|many)$/, ''))
    for (const base of new Set(plurals)) {
      expect(en[`${base}.one`], base).toBeTruthy()
      expect(en[`${base}.many`], base).toBeTruthy()
    }
  })

  it('the components hold no English literal for copy that has a key', () => {
    // Every English value with real words must be gone from the source (comments excluded).
    const code = src
      .split('\n')
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
      .join('\n')
    // A literal is a quoted string or a whole JSX text line; the bare word "commissioner" also names a value.
    const lines = code.split('\n').map((l) => l.trim())
    const leaks = enKeys
      .map((k) => en[k]!)
      .filter((v) => /[A-Za-z]{3,}/.test(v) && !v.includes('{{'))
      .filter(
        (v) =>
          lines.includes(v) ||
          code.includes(`>${v}<`) ||
          // Single words ('pending', 'accept') double as enum values in code, so only phrases count when quoted.
          (v.includes(' ') && [`'${v}'`, `"${v}"`, `\`${v}\``].some((q) => code.includes(q))),
      )
    expect(leaks).toEqual(['Grades are shown for two-team trades.']) // the server's own text, matched to translate it
  })
})
