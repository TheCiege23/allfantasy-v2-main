/**
 * Recommended Moves in Spanish (2026-10-06): DecisionRecommendationsCard (League tab and the other
 * Decision OS surfaces) and the recommendation cards in the Decide home's attention queue.
 *
 * The view model is assembled from the phase 6 engine and the presentation templates, all English and
 * all used off-screen too, so the screens localize the finished model (lib/i18n/decision-os/
 * recommendations.ts). The guard here reads the ENGINE'S OWN SOURCE: every action, every expected
 * impact, every category title, and every evidence template (filled with sample values) must come back
 * Spanish. A sentence added to the engine without Spanish fails here instead of shipping as English.
 *
 * ⚠ `priority` and `confidenceLabel` stay English in the localized model — priorityClass, recSev and
 * the confidence badge branch on them — and the test pins that.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'

import { translations } from '@/lib/i18n/translations'
import { buildDecisionRecommendationsViewModel } from '@/lib/decision-os/recommendations'
import { localizeRecommendations, translateRecText, RECOMMENDATIONS_ES_TABLE } from '@/lib/i18n/decision-os/recommendations'

const h = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations: dict } = await import('@/lib/i18n/translations')
  const t = (k: string) => dict[h.language]?.[k] ?? dict.en[k] ?? k
  return { useLanguage: () => ({ language: h.language, t, setLanguage: () => {} }), useOptionalLanguage: () => ({ language: h.language, t }) }
})
vi.mock('@/components/decide/useProjectedStandings', () => ({ isPreseason: () => false, useProjectedStandings: () => null }))
vi.mock('@/components/decide/WaiverIntel', () => ({ WaiverIntel: () => null }))
vi.mock('@/components/decide/TradeFinder', () => ({ TradeFinder: () => null }))
vi.mock('@/components/decide/MatchupCenter', () => ({ MatchupCenter: () => null }))
vi.mock('@/components/decide/CommissionerPulse', () => ({ CommissionerPulse: () => null }))

import DecisionRecommendationsCard from '@/components/decision-os/DecisionRecommendationsCard'
import { DecideHome } from '@/components/decide/DecideHome'

const ROOT = resolve(__dirname, '..')
const ENGINE = readFileSync(resolve(ROOT, 'lib/decision-os/phase6/recommendations/recommendations.ts'), 'utf8')
const TEMPLATES = readFileSync(resolve(ROOT, 'lib/decision-os/presentation/recommendations.ts'), 'utf8')
const literals = (src: string, key: string) =>
  [...src.matchAll(new RegExp(`${key}: '((?:[^'\\\\]|\\\\.)*)'`, 'g'))].map((m) => m[1]!.replace(/\\'/g, "'"))

/** Every template literal the engine puts into an evidence array or pushes onto `evidence`. */
function evidenceTemplates(src: string): string[] {
  const out: string[] = []
  const take = (body: string) => { for (const m of body.matchAll(/`([^`]*)`/g)) out.push(m[1]!) }
  for (const m of src.matchAll(/evidence\.push\((`[^`]*`)\)/g)) take(m[1]!)
  // `evidence: [ … ]` / `evidence: cond ? [ … ] : [ … ]` — balanced-bracket scan from the key.
  for (const m of src.matchAll(/\n\s+evidence: /g)) {
    let i = m.index! + m[0].length, depth = 0, started = false, j = i
    for (; j < src.length; j++) {
      const c = src[j]
      if (c === '`') { j = src.indexOf('`', j + 1); continue }
      if (c === '[') { depth++; started = true } else if (c === ']') { depth--; if (started && depth === 0 && !/\s*:/.test(src.slice(j + 1, j + 3))) break }
      if (!started && c === '\n') break
    }
    take(src.slice(i, j + 1))
  }
  return [...new Set(out)]
}
/** Fill ${…} with a value of the kind the expression produces. */
function instantiate(tpl: string): string {
  return tpl.replace(/\$\{([^}]*)\}/g, (_m, expr: string) =>
    /toFixed\(1\)/.test(expr) ? '12.5'
    : /toFixed\(0\)|occurrenceCount|Percentile|percentile/.test(expr) ? '3'
    : /confidence|risk|Tier|tier/.test(expr) ? 'high'
    : /archetype|Labels|join/.test(expr) ? 'dormant'
    : '3')
}

describe('🛑 every sentence the engine can put on the card has Spanish', () => {
  const ACTIONS = literals(ENGINE, 'action')
  const IMPACTS = literals(ENGINE, 'expectedImpact')
  const TITLES = literals(TEMPLATES, 'title')
  const EVIDENCE = evidenceTemplates(ENGINE)
  it('read from the real engine and templates', () => {
    expect(ACTIONS.length).toBeGreaterThanOrEqual(46)
    expect(IMPACTS.length).toBeGreaterThanOrEqual(16)
    expect(TITLES.length).toBeGreaterThanOrEqual(16)
    expect(EVIDENCE.length).toBeGreaterThanOrEqual(19) // the parser must see every evidence template
  })
  it('actions, impacts and category titles', () => {
    expect([...ACTIONS, ...IMPACTS, ...TITLES].filter((s) => translateRecText(s) === s)).toEqual([])
  })
  it('every evidence template, filled with sample values', () => {
    expect(EVIDENCE.map(instantiate).filter((s) => translateRecText(s) === s)).toEqual([])
    expect(translateRecText('Supported by an internal engagement assessment, which is not disclosed here'))
      .toBe('Respaldado por una evaluación interna de participación, que no se muestra aquí')
  })
  it('the view model’s own words, every token titleCaseToken can print, and the fallback action', () => {
    const empty = buildDecisionRecommendationsViewModel({ source: null })
    const es = localizeRecommendations(empty, 'es')
    expect(es.title).toBe('Movimientos recomendados')
    expect(es.insufficientData!.missing).toEqual(['Señales de comportamiento', 'Actividad de la liga', 'Oportunidad accionable'])
    for (const tok of ['Critical', 'High', 'Medium', 'Low', 'Easy', 'Moderate', 'Hard', 'Pending', 'In Progress', 'Completed', 'Dismissed', 'Review this opportunity']) {
      expect(translateRecText(tok), tok).not.toBe(tok)
    }
  })
  it('no table row is dead (patterns aside)', () => {
    const live = new Set([...ACTIONS, ...IMPACTS, ...TITLES, 'Supported by an internal engagement assessment, which is not disclosed here',
      'Engagement level suggests managers benefit from commissioner-pushed summaries', 'Recommended Moves', 'Personal action queue', 'Recommendations',
      'None ready yet', 'Ready actions', 'Critical items', 'Evidence points', 'No grounded recommendations yet',
      'Recommendations appear here after enough league and manager activity is available.', 'Behavior signals', 'League activity',
      'Actionable opportunity', 'Review this opportunity', 'Critical', 'High', 'Medium', 'Low', 'Easy', 'Moderate', 'Hard', 'Pending',
      'In Progress', 'Completed', 'Dismissed', 'Unknown'])
    expect(Object.keys(RECOMMENDATIONS_ES_TABLE).filter((k) => !live.has(k))).toEqual([])
  })
})

/* ---------------------------------------------------------------------------------------------- */

const ITEM = (o: Record<string, unknown> = {}) => ({
  recommendationId: 'r1', tier: 'manager', category: 'engagement_boost', entityId: 'm1', priority: 'high',
  severity: { priority: 3 }, colorToken: 'warning', iconToken: 'flame', title: 'Boost Engagement', description: '',
  expectedImpact: 'Improved lineup setting, waiver participation, and seasonal roster performance', difficulty: 'easy', estimatedTime: '5_min',
  supportingEvidence: ['Inactivity gap detected (high confidence, 2x)', 'Supported by an internal engagement assessment, which is not disclosed here'],
  actions: [{ action: 'Enable weekly lineup reminder notifications', rationale: 'r' }], rollbackCriteria: [], prerequisites: [],
  completionStatus: 'pending', relatedGraph: null, relatedKpi: null, benchmarkContext: null, uncertainty: [], derivation: [], completeness: 85, ...o,
})
const READY = () => buildDecisionRecommendationsViewModel({ source: [ITEM(), ITEM({ recommendationId: 'r2', category: 'trade_coaching', priority: 'critical', title: 'Trade Strategy',
  expectedImpact: 'Higher trade acceptance rate, more balanced proposals, improved roster construction via trades', difficulty: 'moderate',
  supportingEvidence: ['3 window(s) with repeated trade rejections'], actions: [{ action: 'Research fair market value before proposing', rationale: 'r' }] })] as never })

const ENGLISH = ['Recommended Moves', 'A short', 'Only grounded recommendations', 'Shown because', 'grounded move', 'Evidence checked', 'Suggested action',
  'Boost Engagement', 'Trade Strategy', 'Improved lineup setting', 'Higher trade acceptance', 'Inactivity gap', 'Supported by an internal',
  'window(s) with repeated', 'Enable weekly lineup', 'Research fair market', 'Easy', 'Moderate', 'Pending', 'Critical', 'High', 'Ready actions',
  'Critical items', 'Evidence points', 'confidence', 'Why am I seeing this']
function englishIn(el: HTMLElement): string[] {
  const parts: string[] = []
  const w = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  for (let n = w.nextNode(); n; n = w.nextNode()) parts.push(n.nodeValue ?? '')
  for (const e of el.querySelectorAll('[title],[aria-label]')) parts.push(e.getAttribute('title') ?? '', e.getAttribute('aria-label') ?? '')
  const hay = parts.join(' | ')
  return ENGLISH.filter((x) => new RegExp(`(^|[^A-Za-z])${x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z])`).test(hay))
}

describe('🛑 the screens read Spanish', () => {
  afterEach(() => { h.language = 'en'; vi.unstubAllGlobals(); cleanup() })

  it('DecisionRecommendationsCard, ready — badge, description, why, evidence, items, chips', () => {
    h.language = 'es'
    const r = render(<DecisionRecommendationsCard model={READY()} variant="league" />)
    const text = r.container.textContent ?? ''
    for (const s of ['Movimientos recomendados', 'Una lista corta de acciones de la liga', 'Aquí solo se muestran recomendaciones fundamentadas',
      'Se muestra porque 2 movimientos fundamentados superaron', 'Evidencia revisada', 'Acciones listas', 'Elementos críticos', 'Crítica', 'Alta',
      'Estrategia de trades', 'Impulsar la participación', 'Moderada', 'Fácil', 'Pendiente', 'Acción sugerida', 'Investiga el valor justo de mercado',
      'Pausa de inactividad detectada (confianza alta, 2 veces)', '3 periodo(s) con trades rechazados repetidamente']) {
      expect(text, s).toContain(s)
    }
    expect(englishIn(r.container)).toEqual([])
  })

  it('DecisionRecommendationsCard, nothing ready — the empty state and the insufficient-data callout', () => {
    h.language = 'es'
    const r = render(<DecisionRecommendationsCard model={buildDecisionRecommendationsViewModel({ source: null })} variant="commissioner" />)
    const text = r.container.textContent ?? ''
    for (const s of ['Una lista de acciones segura para el comisionado', 'Esta tarjeta se muestra para explicar', 'Aún no hay movimientos fundamentados.',
      'Aún no hay recomendaciones fundamentadas', 'Esperando: Señales de comportamiento']) {
      expect(text, s).toContain(s)
    }
    expect(englishIn(r.container)).toEqual([])
  })

  it('priority and confidenceLabel stay English in the model — the chip classes and the badge branch on them', () => {
    const es = localizeRecommendations(READY(), 'es')
    expect(es.recommendations.map((x) => x.priority)).toEqual(['Critical', 'High'])
    expect(es.confidenceLabel).toBe(READY().confidenceLabel)
    expect(localizeRecommendations(READY(), 'en')).toEqual(READY())
  })

  it('🛑 DecideHome’s attention queue — the real view model, localized', async () => {
    h.language = 'es'
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, status: 200,
      json: async () => (String(url).includes('manager-intelligence') ? { recommendations: [ITEM()] } : {}) })))
    const r = render(<DecideHome league={{ id: 'L1', name: 'L', sport: 'NFL', teamCount: 12 } as never} teams={[] as never} onOpenTab={() => {}} />)
    await waitFor(() => expect(r.container.textContent).toContain('Impulsar la participación'))
    const text = r.container.textContent ?? ''
    for (const s of ['Movimiento recomendado', 'Alta', 'impacto: Mejores alineaciones', 'Fácil', 'Sugerido: Activa los avisos semanales para la alineación',
      'Pausa de inactividad detectada']) {
      expect(text, s).toContain(s)
    }
  })

  it('…and English stays English on both', async () => {
    const r = render(<DecisionRecommendationsCard model={READY()} variant="league" />)
    for (const s of ['Recommended Moves', 'A short league action queue', 'Shown because 2 grounded moves passed', 'Evidence checked', 'Critical', 'Trade Strategy',
      'Suggested action', 'Research fair market value before proposing', '3 window(s) with repeated trade rejections']) {
      expect(r.container.textContent, s).toContain(s)
    }
    expect(r.container.textContent).not.toMatch(/\brecCard\./)
    for (const k of Object.keys(translations.en).filter((x) => x.startsWith('recCard.'))) expect(translations.es[k], k).toBeTruthy()
  })
})
