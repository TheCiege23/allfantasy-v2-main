/**
 * Turn a RuleText into a sentence with the app's own `t` (useLanguage). Pure and client-safe.
 *
 * Numbers, dates and lists are formatted for the viewer's language here, so the explainer never bakes
 * an English "0.5" or "Mon, Tue" into a Spanish line.
 */

import { interpolateTemplate } from '@/lib/i18n/interpolate'
import type { ChangeLine, RuleText, RuleVar } from './types'

export type Translate = (key: string) => string

function locale(lang: string): string {
  return lang === 'es' ? 'es-ES' : 'en-US'
}

function formatNumber(n: number, lang: string): string {
  try {
    return new Intl.NumberFormat(locale(lang), { maximumFractionDigits: 2 }).format(n)
  } catch {
    return String(n)
  }
}

function formatDate(iso: string, lang: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  try {
    return new Intl.DateTimeFormat(locale(lang), { dateStyle: 'medium', timeStyle: 'short' }).format(d)
  } catch {
    return d.toISOString()
  }
}

function formatList(items: string[], lang: string): string {
  try {
    const LF = (Intl as unknown as { ListFormat?: new (l: string, o: object) => { format(v: string[]): string } }).ListFormat
    if (LF) return new LF(locale(lang), { style: 'long', type: 'conjunction' }).format(items)
  } catch {
    // fall through
  }
  return items.join(', ')
}

function renderVar(v: RuleVar, t: Translate, lang: string): string {
  if (typeof v === 'number') return formatNumber(v, lang)
  if (typeof v === 'string') return v
  if ('date' in v) return formatDate(v.date, lang)
  if ('list' in v) return formatList(v.list.map((item) => renderVar(item, t, lang)).filter(Boolean), lang)
  return renderRuleText(v, t, lang)
}

export function renderRuleText(text: RuleText, t: Translate, lang = 'en'): string {
  const vars: Record<string, string> = {}
  for (const [name, value] of Object.entries(text.vars ?? {})) vars[name] = renderVar(value, t, lang)
  return interpolateTemplate(t(text.k), vars)
}

/** "Trade deadline: Week 12 → Week 13 — trades are allowed one week longer." */
export function renderChangeLine(line: ChangeLine, t: Translate, lang = 'en'): string {
  const head = renderRuleText(
    { k: 'leagueRules.change.line', vars: { label: line.label, before: line.before, after: line.after } },
    t,
    lang,
  )
  if (!line.consequence) return head
  return renderRuleText({ k: 'leagueRules.change.withConsequence', vars: { line: head, consequence: line.consequence } }, t, lang)
}
