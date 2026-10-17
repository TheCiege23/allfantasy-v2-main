/**
 * The shared Decision OS primitives in both languages (2026-10-06), and the three cards that render
 * the ones with words of their own: LeaguePulseCard, DecisionRecommendationsCard, UserOsCard.
 *
 * 🛑 THE PRIMITIVES' OWN WORDS WERE ENGLISH under every card: "<label> confidence" with its title and
 * aria-label, "Why am I seeing this?", the evidence grid's empty message, "Waiting for:", the loading
 * skeleton's "Loading". They follow the pattern formatDecisionOsUpdated set on 2026-10-04 — an optional
 * `language` prop, English by default, no hook (the file has no 'use client'; server components import
 * it) — and the cards pass the reader's language down.
 *
 * ⚠ The confidence badge's tone and icon must still key off the ENGLISH label: the test pins that the
 * Spanish badge carries exactly the English badge's classes.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

const h = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations: dict } = await import('@/lib/i18n/translations')
  const t = (k: string) => dict[h.language]?.[k] ?? dict.en[k] ?? k
  return { useLanguage: () => ({ language: h.language, t, setLanguage: () => {} }), useOptionalLanguage: () => ({ language: h.language, t }) }
})

import {
  DecisionOsConfidenceBadge, DecisionOsEvidenceGrid, DecisionOsInsufficientDataCallout, DecisionOsLoadingSkeleton, DecisionOsWhyPanel,
} from '@/components/decision-os/DecisionOsCardPrimitives'
import LeaguePulseCard from '@/components/decision-os/LeaguePulseCard'
import DecisionRecommendationsCard from '@/components/decision-os/DecisionRecommendationsCard'
import UserOsCard from '@/components/decision-os/UserOsCard'
import { buildLeagueHomePulse } from '@/lib/decision-os/league-pulse'
import { localizeLeaguePulse } from '@/lib/i18n/decision-os/leaguePulse'

/** The primitives' former English. Word-bounded, case-sensitive, per text node / title / aria-label. */
const FORMER_ENGLISH = ['confidence', 'Confidence reflects', 'Based on available evidence', 'Why am I seeing this', 'Evidence will appear',
  'Waiting for', 'Loading', 'Updated', 'Your team intelligence', 'Real activity, engagement', "This league's data", 'manager activity', 'Your Team']
function englishIn(el: HTMLElement): string[] {
  const parts: string[] = []
  const w = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  for (let n = w.nextNode(); n; n = w.nextNode()) parts.push(n.nodeValue ?? '')
  for (const e of el.querySelectorAll('[title],[aria-label]')) parts.push(e.getAttribute('title') ?? '', e.getAttribute('aria-label') ?? '')
  const hay = parts.join(' | ')
  return FORMER_ENGLISH.filter((x) => new RegExp(`(^|[^A-Za-z])${x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z])`).test(hay))
}
const NOW = '2026-10-06T16:30:00Z'

afterEach(() => { h.language = 'en'; cleanup() })

describe('🛑 the primitives say their own words in Spanish when handed language="es"', () => {
  it.each([['High', 'alta'], ['Medium', 'media'], ['Low', 'baja']] as const)('confidence badge — %s', (label, es) => {
    const s = render(<DecisionOsConfidenceBadge label={label} language="es" />).container.firstElementChild as HTMLElement
    expect(s.textContent).toBe(`Confianza ${es}`)
    expect(s.getAttribute('title')).toBe('La confianza refleja la cobertura de la evidencia disponible, no un resultado garantizado.')
    expect(s.getAttribute('aria-label')).toBe(`Confianza ${es}. Basada en la evidencia disponible, no en un resultado garantizado.`)
    cleanup()
    const e = render(<DecisionOsConfidenceBadge label={label} />).container.firstElementChild as HTMLElement
    expect(e.textContent).toBe(`${label} confidence`)
    // Tone and icon key off the English label, so both languages carry the same classes.
    expect(s.className).toBe(e.className)
  })
  it('why panel, evidence grid (empty), insufficient-data callout, loading skeleton', () => {
    const r = render(
      <div>
        <DecisionOsWhyPanel language="es">x</DecisionOsWhyPanel>
        <DecisionOsEvidenceGrid title="T" items={[]} language="es" />
        <DecisionOsInsufficientDataCallout title="A" message="B" missing={['m1', 'm2']} language="es" />
        <DecisionOsLoadingSkeleton language="es" />
      </div>,
    )
    const text = r.container.textContent ?? ''
    for (const s of ['¿Por qué veo esto?', 'La evidencia aparecerá aquí cuando haya suficientes datos que la respalden.', 'Esperando: m1, m2']) {
      expect(text, s).toContain(s)
    }
    expect(r.container.querySelector('[role="status"]')?.getAttribute('aria-label')).toBe('Cargando')
    expect(englishIn(r.container)).toEqual([])
  })
  it('a caller-supplied empty message still wins over the default', () => {
    const r = render(<DecisionOsEvidenceGrid title="T" items={[]} language="es" emptyMessage="propio" />)
    expect(r.container.textContent).toContain('propio')
  })
  it('…and with no language, every primitive is the English it always was', () => {
    const r = render(
      <div>
        <DecisionOsWhyPanel>x</DecisionOsWhyPanel>
        <DecisionOsEvidenceGrid title="T" items={[]} />
        <DecisionOsInsufficientDataCallout title="A" message="B" missing={['m1']} />
        <DecisionOsLoadingSkeleton />
      </div>,
    )
    const text = r.container.textContent ?? ''
    for (const s of ['Why am I seeing this?', 'Evidence will appear here once enough supported data is available.', 'Waiting for: m1']) expect(text, s).toContain(s)
    expect(r.container.querySelector('[role="status"]')?.getAttribute('aria-label')).toBe('Loading')
  })
})

describe('🛑 the cards pass the reader’s language down', () => {
  it('LeaguePulseCard — badge, stamp, why panel, waiting-for, all Spanish', () => {
    h.language = 'es'
    const pulse = localizeLeaguePulse(buildLeagueHomePulse({ league: { id: 'L1' }, teams: [], now: new Date(NOW) }), 'es')
    const r = render(<LeaguePulseCard pulse={pulse} variant="league" />)
    const text = r.container.textContent ?? ''
    for (const s of ['Confianza baja', 'Actualizado', '¿Por qué veo esto?', 'Esperando: ']) expect(text, s).toContain(s)
    expect(englishIn(r.container)).toEqual([])
  })
  it('DecisionRecommendationsCard — the primitives inside it read Spanish', () => {
    h.language = 'es'
    const model = { title: 'T', subtitle: 'S', status: 'insufficient-data', confidenceLabel: 'Medium', evidence: [], recommendations: [],
      lastUpdatedIso: NOW, insufficientData: { title: 'IT', message: 'IM', missing: ['m1'] } } as never
    const r = render(<DecisionRecommendationsCard model={model} variant="league" />)
    const text = r.container.textContent ?? ''
    for (const s of ['Confianza media', 'Actualizado', '¿Por qué veo esto?', 'Esperando: m1']) expect(text, s).toContain(s)
    expect(r.container.textContent).not.toMatch(/\bconfidence\b|Why am I seeing this|Waiting for|Updated /)
  })
  it('UserOsCard — its loading and unavailable states, which ignored language until now', () => {
    const loading = render(<UserOsCard snapshot={null} language="es" />)
    expect(loading.container.textContent).toContain('Cargando la información de tu equipo')
    expect(englishIn(loading.container)).toEqual([])
    cleanup()
    const down = render(<UserOsCard snapshot={{ available: false } as never} language="es" />)
    const text = down.container.textContent ?? ''
    for (const s of ['Tu equipo', 'La información de tu equipo no está disponible', 'Ahora mismo no se pudieron cargar', 'Esperando: actividad del mánager']) {
      expect(text, s).toContain(s)
    }
    expect(down.container.querySelector('[aria-label="Tu equipo"]')).not.toBeNull()
    expect(englishIn(down.container)).toEqual([])
  })
  it('…and all three cards read English in English', () => {
    const pulse = buildLeagueHomePulse({ league: { id: 'L1' }, teams: [], now: new Date(NOW) })
    const p = render(<LeaguePulseCard pulse={pulse} variant="league" />)
    for (const s of ['Low confidence', 'Updated', 'Why am I seeing this?', 'Waiting for: ']) expect(p.container.textContent, s).toContain(s)
    cleanup()
    const down = render(<UserOsCard snapshot={{ available: false } as never} />)
    for (const s of ['Your Team', 'Your team intelligence is unavailable', "This league's data couldn't be loaded right now.", 'Waiting for: manager activity']) {
      expect(down.container.textContent, s).toContain(s)
    }
  })
})
