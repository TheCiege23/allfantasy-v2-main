import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getAppIntlLocale, setAppIntlLanguage } from '@/lib/i18n/appLocale'
import { applyLanguageToDocument } from '@/lib/preferences/HtmlPreferenceSync'
import { formatCompact, formatValue } from '@/components/core-app/portfolio/PortfolioCharts'

/**
 * Numbers and dates in /core format in the reader's language, through one module value that the
 * client language commit (`applyLanguageToDocument`) sets — and that stays 'en-US' until then, so
 * server HTML and the hydrating render agree.
 */

afterEach(() => setAppIntlLanguage('en'))

describe('getAppIntlLocale', () => {
  it('is en-US until the client language is committed', () => {
    expect(getAppIntlLocale()).toBe('en-US')
  })

  it('follows applyLanguageToDocument', () => {
    applyLanguageToDocument('es')
    expect(getAppIntlLocale()).toBe('es')
    expect((12345).toLocaleString(getAppIntlLocale())).toBe('12.345')
    applyLanguageToDocument('en')
    expect((12345).toLocaleString(getAppIntlLocale())).toBe('12,345')
  })

  it('formats the portfolio chart values in the reader’s language, per call', () => {
    expect(formatValue(2_050_000)).toBe('2.05M')
    setAppIntlLanguage('es')
    expect(formatValue(2_050_000)).not.toBe('2.05M')
    expect(formatCompact(2_100_000)).toMatch(/2,1/)
  })
})

describe('no locale-less formatting left in /core', () => {
  const ROOT = join(__dirname, '../../components/core-app')
  const files: string[] = []
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.tsx?$/.test(n)) files.push(p)
    }
  }
  walk(ROOT)

  it('passes a locale to every toLocale*String call (runtime locale = hydration mismatch)', () => {
    // ChimmyTrades writes grounding text for the assistant; it is deliberately left as it was.
    const allowed = new Set(['comms/ChimmyTrades.tsx'])
    const offenders = files
      .filter((p) => !allowed.has(relative(ROOT, p).replace(/\\/g, '/')))
      .flatMap((p) =>
        readFileSync(p, 'utf8')
          .split('\n')
          .map((line, i) => [relative(ROOT, p), i + 1, line] as const)
          .filter(([, , line]) => /\.toLocale(Date|Time)?String\(\s*(\)|undefined\s*,)/.test(line)),
      )
      .map(([f, n]) => `${f}:${n}`)
    expect(offenders).toEqual([])
  })
})
