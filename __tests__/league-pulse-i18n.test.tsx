/**
 * League Pulse in Spanish (2026-10-06): the "Fantasy OS" health card at the top of a league's Decide
 * home and in its League tab.
 *
 * `buildLeagueHomePulse` writes English and is also called server-side, so the engine is untouched
 * and the two screens localize the finished view model (`lib/i18n/decision-os/leaguePulse.ts`). The
 * guard below therefore drives the REAL engine through its branches — no league, no claimed team, one
 * and several orphan slots, a missing draft date, a wide points spread, Manager DNA — and fails on any
 * sentence it writes that has no Spanish. A new engine sentence cannot ship as English in Spanish.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'

import { translations } from '@/lib/i18n/translations'
import { buildDashboardLeaguePulse, buildLeagueHomePulse, type LeaguePulseViewModel } from '@/lib/decision-os/league-pulse'
import { localizeLeaguePulse, translatePulseText, LEAGUE_PULSE_ES_TABLE } from '@/lib/i18n/decision-os/leaguePulse'

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

import LeaguePulseCard from '@/components/decision-os/LeaguePulseCard'
import { DecideHome } from '@/components/decide/DecideHome'

const NOW = new Date('2026-10-06T12:00:00Z')
const team = (i: number, o: { claimed?: boolean; orphan?: boolean; pf?: number } = {}) => ({
  id: `t${i}`, teamName: `T${i}`, ownerName: `o${i}`, wins: 1, losses: 1, ties: 0,
  claimedByUserId: o.claimed === false ? null : `u${i}`, platformUserId: o.orphan ? null : `p${i}`, isOrphan: Boolean(o.orphan),
  pointsFor: o.pf ?? 100 + i, pointsAgainst: 90,
})
const twelve = (orphans: number, spread = false) =>
  Array.from({ length: 12 }, (_, i) => team(i, { orphan: i < orphans, claimed: !(i < orphans), pf: spread ? (i === 11 ? 500 : 100) : 100 + i }))
const league = (o: Record<string, unknown> = {}) => ({ id: 'L1', name: 'L', sport: 'NFL', teamCount: 12, lifecycleState: 'in_season', ...o })
const DNA = { primaryIdentity: 'value_hunter', confidence: 0.8 } as never

/** Every branch of the engine the league screens can reach. */
const SCENARIOS: Array<[string, LeaguePulseViewModel]> = [
  ['no teams', buildLeagueHomePulse({ league: league(), teams: [], now: NOW })],
  ['no teams, commissioner', buildLeagueHomePulse({ league: league(), teams: [], isCommissioner: true, now: NOW })],
  ['no claimed team', buildLeagueHomePulse({ league: league(), teams: [team(1, { claimed: false })], now: NOW })],
  ['no claimed team, commissioner', buildLeagueHomePulse({ league: league(), teams: [team(1, { claimed: false })], isCommissioner: true, now: NOW })],
  ['healthy', buildLeagueHomePulse({ league: league(), teams: twelve(0), now: NOW })],
  ['one orphan', buildLeagueHomePulse({ league: league(), teams: twelve(1), now: NOW })],
  ['watch, commissioner', buildLeagueHomePulse({ league: league(), teams: twelve(2), isCommissioner: true, now: NOW })],
  ['at risk', buildLeagueHomePulse({ league: league(), teams: twelve(5), now: NOW })],
  ['missing draft date', buildLeagueHomePulse({ league: league({ lifecycleState: 'pre_draft' }), teams: twelve(0), now: NOW })],
  ['wide spread', buildLeagueHomePulse({ league: league(), teams: twelve(0, true), now: NOW })],
  ['unknown state + manager DNA', buildLeagueHomePulse({ league: league({ lifecycleState: null }), teams: twelve(0), managerDna: DNA, now: NOW })],
  // The engine's base empty pulse — what a no-league dashboard shows; the league screens override parts of it.
  ['dashboard, no leagues', buildDashboardLeaguePulse({ connectedLeagues: [], now: NOW })],
  ['single team (no spread)', buildLeagueHomePulse({ league: league({ teamCount: 1 }), teams: [team(1)], now: NOW })],
]

/** Every human-readable string a pulse carries, paired across languages. */
function pairs(en: LeaguePulseViewModel, es: LeaguePulseViewModel): Array<[string, string]> {
  const out: Array<[string, string]> = [
    [en.title, es.title], [en.statusLabel, es.statusLabel], [en.headline, es.headline], [en.summary, es.summary], [en.why, es.why],
    [en.nextAction.label, es.nextAction.label], [en.nextAction.detail, es.nextAction.detail],
    ...en.derivation.map((d, i) => [d, es.derivation[i]!] as [string, string]),
    ...en.evidence.flatMap((e, i) => [[e.label, es.evidence[i]!.label], [e.value, es.evidence[i]!.value],
      ...(e.detail ? [[e.detail, es.evidence[i]!.detail!]] : [])] as Array<[string, string]>),
    ...en.metrics.flatMap((m, i) => [[m.label, es.metrics[i]!.label], [m.value, es.metrics[i]!.value]] as Array<[string, string]>),
  ]
  if (en.insufficientData && es.insufficientData) {
    out.push([en.insufficientData.title, es.insufficientData.title], [en.insufficientData.message, es.insufficientData.message],
      ...en.insufficientData.missing.map((m, i) => [m, es.insufficientData!.missing[i]!] as [string, string]))
  }
  return out
}
/** Identifiers and numbers that read the same in Spanish. */
const SAME = (s: string) => /^[\d./%\s—-]+$/.test(s) || s === 'Fantasy OS' || s === 'playoffs'

describe('🛑 every sentence the engine writes has Spanish', () => {
  it.each(SCENARIOS)('%s', (_name, en) => {
    const es = localizeLeaguePulse(en, 'es')
    expect(pairs(en, es).filter(([a, b]) => a === b && !SAME(a)).map(([a]) => a)).toEqual([])
  })
  it('reaches every status the engine has', () => {
    expect(new Set(SCENARIOS.map(([, p]) => p.statusLabel))).toEqual(new Set(['Insufficient data', 'Healthy', 'Watch', 'At risk']))
  })
  it('the table carries no row the engine never writes (league states and confidence words aside)', () => {
    const produced = new Set(SCENARIOS.flatMap(([, p]) => pairs(p, p).map(([a]) => a)))
    const STATES = ['pre_draft', 'drafting', 'post_draft', 'in_season', 'playoffs', 'complete', 'completed', 'active', 'offseason', 'High', 'Medium', 'Low']
    expect(Object.keys(LEAGUE_PULSE_ES_TABLE).filter((k) => !produced.has(k) && !STATES.includes(k))).toEqual([])
  })
  it('the counted sentences: singular, plural, confidence, identity', () => {
    expect(translatePulseText('1 manager slot need attention.')).toBe('1 puesto de mánager necesita atención.')
    expect(translatePulseText('5 manager slots need attention.')).toBe('5 puestos de mánager necesitan atención.')
    expect(translatePulseText('80% confidence')).toBe('80% de confianza')
    expect(translatePulseText('Decision Intelligence identity: value hunter')).toBe('Identidad de Decision Intelligence: value hunter')
    expect(translatePulseText('A sentence written tomorrow')).toBe('A sentence written tomorrow')
  })
  it('English is the SAME object, and confidenceLabel stays English for the badge that styles by it', () => {
    const p = SCENARIOS[4]![1]
    expect(localizeLeaguePulse(p, 'en')).toBe(p)
    expect(localizeLeaguePulse(p, 'fr')).toBe(p)
    expect(localizeLeaguePulse(p, 'es').confidenceLabel).toBe(p.confidenceLabel)
  })
})

describe('the card and the screens', () => {
  afterEach(() => { h.language = 'en'; vi.unstubAllGlobals(); cleanup() })
  const CARD_ENGLISH = ['This pulse is evidence-backed', 'Based on', 'Decision path', 'Next action', 'Continue']
  const englishNodes = (el: HTMLElement, sentences: string[]) => {
    const parts: string[] = []
    const w = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    for (let n = w.nextNode(); n; n = w.nextNode()) parts.push((n.nodeValue ?? '').trim())
    return [...CARD_ENGLISH.filter((c) => parts.some((p) => p.includes(c))), ...parts.filter((p) => sentences.includes(p) && !SAME(p))]
  }

  it('🛑 LeaguePulseCard reads Spanish — its own copy and the localized pulse', () => {
    h.language = 'es'
    const en = SCENARIOS[6]![1]
    const r = render(<LeaguePulseCard pulse={localizeLeaguePulse(en, 'es')} variant="league" />)
    const text = r.container.textContent ?? ''
    for (const s of ['Este pulso se basa en evidencia', 'Basado en', 'Cómo se decidió', 'Siguiente paso', 'Continuar', 'Pulso de la liga',
      'En observación', '2 puestos de mánager necesitan atención.', 'Equipos revisados', 'Invitar mánagers']) {
      expect(text, s).toContain(s)
    }
    expect(englishNodes(r.container, pairs(en, en).map(([a]) => a))).toEqual([])
  })

  it('🛑 DecideHome renders the REAL engine’s pulse in Spanish, confidence word included', async () => {
    h.language = 'es'
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })))
    const teams = twelve(1) as never
    const r = render(<DecideHome league={league({ platform: 'sleeper' }) as never} teams={teams} userTeamId="t3" onOpenTab={() => {}} />)
    await waitFor(() => expect(r.container.textContent).toContain('1 puesto de mánager necesita atención.'))
    const text = r.container.textContent ?? ''
    for (const s of ['Saludable', 'Equipos revisados: ', 'Puestos de mánager libres: ', 'Estado de la liga: ', 'en temporada',
      'Comparó el número de equipos esperado', 'Ver mánagers']) {
      expect(text, s).toContain(s)
    }
    expect(text).toMatch(/\d+% · (Alta|Media|Baja)/)
    const en = buildLeagueHomePulse({ league: league({ platform: 'sleeper' }), teams: twelve(1) as never })
    expect(englishNodes(r.container, pairs(en, en).map(([a]) => a))).toEqual([])
  })

  it('…English is untouched on both screens, and both wire the localizer', async () => {
    const en = SCENARIOS[6]![1]
    const r = render(<LeaguePulseCard pulse={localizeLeaguePulse(en, 'en')} variant="league" />)
    for (const s of ['This pulse is evidence-backed and deterministic.', 'Based on', 'Decision path', 'Next action', en.headline]) {
      expect(r.container.textContent, s).toContain(s)
    }
    expect(r.container.textContent).not.toMatch(/\bpulseCard\./)
    for (const f of ['components/decide/DecideHome.tsx', 'app/league/[leagueId]/tabs/LeagueTab.tsx']) {
      expect(readFileSync(resolve(__dirname, '..', f), 'utf8'), f).toMatch(/localizeLeaguePulse\(\s*buildLeagueHomePulse\(/)
    }
    for (const k of ['pulseCard.trustNote', 'pulseCard.basedOn', 'pulseCard.decisionPath', 'pulseCard.nextAction', 'pulseCard.continue']) {
      expect(translations.en[k], k).toBeTruthy()
      expect(translations.es[k], k).toBeTruthy()
    }
  })
})
