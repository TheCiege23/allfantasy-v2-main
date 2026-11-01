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

/**
 * The child panels the Trade Center renders (2026-10-31): commissioner review, trade block, Find a
 * Trade, the two market panels, the reverse-trade dialog, the value breakdown, and the modal's close
 * button. Codes the server sends are read off the modules that define them, so a new code without copy
 * fails here rather than reaching the screen as a raw key.
 */
const PANEL_FILES = [
  'components/trade-review/TradeReviewPanel.tsx',
  'app/league/[leagueId]/tabs/redraft/TradeBlockPanel.tsx',
  'app/league/[leagueId]/tabs/redraft/TradeDiscoveryPanel.tsx',
  'app/league/[leagueId]/tabs/redraft/MarketSnapshotPanel.tsx',
  'app/league/[leagueId]/tabs/redraft/MarketValuePanel.tsx',
  'components/league-trade/ReverseTradeDialog.tsx',
  'components/trade-value/TradeValueBreakdown.tsx',
]
const PANEL_NAMESPACES = ['review', 'block', 'discovery', 'snapshot', 'marketValue', 'reverseDialog', 'value']
const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), 'utf8')
const panelSrc = PANEL_FILES.map(read).join('\n')

/** The quoted members of a string-literal union or the keys of an object literal, between two markers. */
function between(file: string, start: string, end: string, re: RegExp): string[] {
  const s = read(file)
  const from = s.indexOf(start)
  if (from < 0) throw new Error(`${start} not found in ${file}`)
  const body = s.slice(from + start.length, s.indexOf(end, from + start.length))
  return [...body.matchAll(re)].map((m) => m[1]!)
}

const REVIEW_CODES = between('lib/decision-os/trade/tradeReview.ts', 'export type ReviewFlagCode =', 'export type', /\| '([a-z_]+)'/g)
const RECOMMENDATIONS = between('lib/decision-os/trade/tradeReview.ts', 'export type TradeReviewRecommendation =', '\n', /'([a-z_]+)'/g)
const FAIRNESS_BANDS = between('lib/trade-discovery/redraftTradeDiscovery.ts', 'export type FairnessBand =', '\n', /'([a-z ]+)'/g)
const PACKAGE_FLAGS = [
  ...new Set(between('lib/trade-discovery/redraftTradeDiscovery.ts', 'export function findPackages(', '\nexport ', /warningFlags\.push\('([A-Z_]+)'\)/g)),
]
const BLOCKER_CODES = between('lib/trade-reversal/client.ts', 'const BLOCKER_COPY: Record<string, string> = {', '\n}', /^ {2}([A-Z_]+):/gm)

const PANEL_DYNAMIC: string[] = [
  ...RECOMMENDATIONS.map((c) => `tradeCenter.review.recommendation.${c}`),
  ...REVIEW_CODES.map((c) => `tradeCenter.review.check.${c}`),
  ...['private', 'public'].map((v) => `tradeCenter.block.visibility.${v}`),
  ...FAIRNESS_BANDS.map((b) => `tradeCenter.discovery.fairness.${b.replace(/ /g, '_')}`),
  ...PACKAGE_FLAGS.map((f) => `tradeCenter.discovery.flag.${f}`),
  ...['rising', 'falling', 'stable', 'insufficient'].map((d) => `tradeCenter.snapshot.direction.${d}`),
  ...BLOCKER_CODES.map((c) => `tradeCenter.reverseDialog.blocker.${c}`),
  ...['projection', 'idp', 'market', 'none'].flatMap((b) => [`tradeCenter.value.basis.${b}.short`, `tradeCenter.value.basis.${b}.long`]),
  'tradeCenter.value.unpriced.one',
  'tradeCenter.value.unpriced.many',
]

describe('tradeCenter.* dictionary — the child panels', () => {
  it('the code lists were actually read (a regex that matches nothing would pass everything)', () => {
    expect(REVIEW_CODES.length).toBeGreaterThanOrEqual(8)
    expect(REVIEW_CODES).toContain('class_gap')
    expect(RECOMMENDATIONS).toEqual(['approve', 'review_with_managers', 'consider_veto'])
    expect(FAIRNESS_BANDS).toEqual(['balanced', 'slight edge you', 'slight edge partner', 'lopsided', 'low confidence'])
    expect(PACKAGE_FLAGS).toContain('FAAB_UNSUPPORTED_OR_LIMITED')
    expect(PACKAGE_FLAGS.length).toBeGreaterThanOrEqual(7)
    expect(BLOCKER_CODES.length).toBeGreaterThanOrEqual(16)
    expect(BLOCKER_CODES).toContain('CAP_RECORD_MOVED_SINCE_EXECUTION')
  })

  it('every key the panels reference, or build from a server code, exists in English and in Spanish', () => {
    const keys = new Set(PANEL_DYNAMIC)
    for (const m of panelSrc.matchAll(/'(tradeCenter\.[a-zA-Z0-9_.]+)'/g)) keys.add(m[1]!)
    expect(keys.size).toBeGreaterThan(130)
    expect([...keys].filter((k) => !(k in en))).toEqual([])
    expect([...keys].filter((k) => !(k in es))).toEqual([])
    expect('tradeCenter.modal.close' in es).toBe(true)
  })

  it('each panel namespace has real Spanish: present, different from the English, no «waiver», no «traspaso»', () => {
    for (const ns of PANEL_NAMESPACES) {
      const keys = enKeys.filter((k) => k.startsWith(`tradeCenter.${ns}.`))
      expect(keys.length, ns).toBeGreaterThan(4)
      expect(keys.filter((k) => !(k in es)), ns).toEqual([])
      expect(keys.filter((k) => es[k] === en[k]), ns).toEqual([])
      expect(keys.filter((k) => /waiver|traspaso/i.test(es[k] ?? '')), ns).toEqual([])
      expect(keys.filter((k) => /\bAI\b|\bIA\b/.test(es[k] ?? '')), ns).toEqual([])
    }
  })

  it('placeholders match between English and Spanish', () => {
    const vars = (s: string) => [...s.matchAll(/\{\{([a-zA-Z0-9_]+)\}\}/g)].map((m) => m[1]).sort()
    for (const ns of PANEL_NAMESPACES) {
      for (const k of enKeys.filter((x) => x.startsWith(`tradeCenter.${ns}.`))) expect(vars(es[k] ?? ''), k).toEqual(vars(en[k]!))
    }
  })

  it('the reversal blockers keep describeBlocker’s English word for word', async () => {
    const { describeBlocker } = await import('@/lib/trade-reversal/client')
    for (const code of BLOCKER_CODES) expect(en[`tradeCenter.reverseDialog.blocker.${code}`], code).toBe(describeBlocker(code))
    expect(en['tradeCenter.reverseDialog.blocker.unknown']!.replace('{{code}}', 'X')).toBe(describeBlocker('X'))
  })

  it('the panels hold no English literal for copy that has a key', () => {
    const code = panelSrc
      .split('\n')
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
      .join('\n')
    const lines = code.split('\n').map((l) => l.trim())
    const leaks = enKeys
      .filter((k) => PANEL_NAMESPACES.some((ns) => k.startsWith(`tradeCenter.${ns}.`)))
      .map((k) => en[k]!)
      .filter((v) => /[A-Za-z]{3,}/.test(v) && !v.includes('{{'))
      .filter(
        (v) =>
          lines.includes(v) ||
          code.includes(`>${v}<`) ||
          (v.includes(' ') && [`'${v}'`, `"${v}"`, `\`${v}\``].some((q) => code.includes(q))),
      )
    // The one grade's labels arrive from the server in English; the block panel matches them to translate.
    expect(leaks.sort()).toEqual(['Major overpay', 'Major win (you)', 'Slightly favors opponent', 'Slightly favors you'])
  })
})
